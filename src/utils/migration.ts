import { db } from '../config/firebase';
import { doc, getDoc, getDocs, setDoc, collection } from 'firebase/firestore';
import {
  DEFAULT_SITE_SETTINGS,
  DEFAULT_SITE_CONTENT,
  DEFAULT_SERVICE_CATEGORIES,
  DEFAULT_SERVICES,
  DEFAULT_SERVICE_AREAS,
  DEFAULT_REVIEWS,
  DEFAULT_PROVIDERS,
  DEFAULT_INTEGRATIONS,
} from '../data/defaults';

/**
 * Strips undefined properties recursively from an object for Firestore compatibility
 */
export function removeUndefinedFields<T extends Record<string, any>>(obj: T): T {
  const cleanObj: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      continue;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      cleanObj[key] = removeUndefinedFields(value);
    } else {
      cleanObj[key] = value;
    }
  }
  return cleanObj as T;
}

export interface MigrationSummary {
  discovered: number;
  migrated: number;
  skipped: number;
  failed: number;
  isDryRun: boolean;
  details: { collection: string; id: string; status: 'migrated' | 'skipped' | 'failed'; error?: string }[];
}

export interface DuplicateReport {
  collection: string;
  totalDocuments: number;
  duplicateIds: string[];
  logicalDuplicates: { primaryId: string; duplicateId: string; reason: string }[];
}

// Mutex flag preventing concurrent migration runs
let isMigrationRunning = false;

/**
 * Idempotent migration runner that transfers default datasets into Firestore.
 * Supports Dry-Run mode to preview operations before committing writes.
 * Uses mutex locks and stable IDs to prevent duplicate insertion.
 */
export async function runIdempotentMigration(options?: { dryRun?: boolean }): Promise<MigrationSummary> {
  const isDryRun = Boolean(options?.dryRun);

  if (isMigrationRunning && !isDryRun) {
    console.warn('[ONS Migration Guard] Migration is already in progress. Concurrent execution blocked.');
    return {
      discovered: 0,
      migrated: 0,
      skipped: 0,
      failed: 0,
      isDryRun,
      details: [{ collection: 'system', id: 'mutex', status: 'skipped', error: 'Concurrent migration blocked by mutex lock' }],
    };
  }

  if (!isDryRun) {
    isMigrationRunning = true;
  }

  const summary: MigrationSummary = {
    discovered: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
    isDryRun,
    details: [],
  };

  try {
    if (!db) return summary;

    const datasetList = [
      { collection: 'siteSettings', items: [{ id: 'global', ...DEFAULT_SITE_SETTINGS }] },
      { collection: 'siteContent', items: [{ id: 'global', ...DEFAULT_SITE_CONTENT }] },
      { collection: 'serviceCategories', items: DEFAULT_SERVICE_CATEGORIES },
      { collection: 'services', items: DEFAULT_SERVICES },
      { collection: 'serviceAreas', items: DEFAULT_SERVICE_AREAS },
      { collection: 'reviews', items: DEFAULT_REVIEWS },
      { collection: 'serviceProviders', items: DEFAULT_PROVIDERS },
      { collection: 'integrations', items: DEFAULT_INTEGRATIONS },
    ];

    let consecutiveFailures = 0;

    for (const group of datasetList) {
      if (consecutiveFailures >= 5 && !isDryRun) {
        console.warn('[ONS Migration Halted] Halted due to repeated permission or write failures.');
        break;
      }

      for (const item of group.items) {
        summary.discovered++;
        const docId = item.id;
        const docRef = doc(db, group.collection, docId);

        try {
          const snap = await getDoc(docRef);
          if (snap.exists()) {
            summary.skipped++;
            summary.details.push({ collection: group.collection, id: docId, status: 'skipped' });
          } else {
            if (isDryRun) {
              summary.migrated++;
              summary.details.push({ collection: group.collection, id: docId, status: 'migrated' });
            } else {
              const sanitizedPayload = removeUndefinedFields({
                ...item,
                updatedAt: new Date().toISOString(),
              });
              await setDoc(docRef, sanitizedPayload, { merge: true });
              summary.migrated++;
              summary.details.push({ collection: group.collection, id: docId, status: 'migrated' });
              consecutiveFailures = 0;
            }
          }
        } catch (err: any) {
          summary.failed++;
          consecutiveFailures++;
          summary.details.push({
            collection: group.collection,
            id: docId,
            status: 'failed',
            error: err.message || String(err),
          });

          if (consecutiveFailures >= 5 && !isDryRun) {
            console.warn('[ONS Migration Halted] Stopping remaining dataset writes due to permission errors.');
            break;
          }
        }
      }
    }

    console.log(`[ONS Migration ${isDryRun ? 'Dry-Run' : 'Live'} Complete]`, summary);
    return summary;
  } finally {
    if (!isDryRun) {
      isMigrationRunning = false;
    }
  }
}

/**
 * Diagnostic tool to detect exact duplicate document IDs or logical duplicate records
 * across all active Firestore collections without performing any deletions.
 */
export async function detectDuplicatesInFirestore(): Promise<DuplicateReport[]> {
  const reports: DuplicateReport[] = [];
  if (!db) return reports;

  const collectionsToAudit = [
    { name: 'serviceProviders', keyFn: (d: any) => `${d.name?.trim()}_${d.phone?.trim()}` },
    { name: 'services', keyFn: (d: any) => d.slug?.trim() || d.nameAr?.trim() },
    { name: 'serviceCategories', keyFn: (d: any) => d.slug?.trim() || d.nameAr?.trim() },
    { name: 'serviceAreas', keyFn: (d: any) => d.nameAr?.trim() },
    { name: 'reviews', keyFn: (d: any) => `${d.authorNameAr?.trim()}_${d.commentAr?.trim()}` },
    { name: 'customerRequests', keyFn: (d: any) => `${d.customerName?.trim()}_${d.phone?.trim()}_${d.serviceId?.trim()}` },
  ];

  for (const colDef of collectionsToAudit) {
    try {
      const snap = await getDocs(collection(db, colDef.name));
      const seenIds = new Set<string>();
      const duplicateIds: string[] = [];
      const seenLogicalKeys = new Map<string, string>();
      const logicalDuplicates: { primaryId: string; duplicateId: string; reason: string }[] = [];

      snap.docs.forEach((docSnap) => {
        const id = docSnap.id;
        if (seenIds.has(id)) {
          duplicateIds.push(id);
        } else {
          seenIds.add(id);
        }

        const data = docSnap.data();
        const logicalKey = colDef.keyFn(data);
        if (logicalKey) {
          if (seenLogicalKeys.has(logicalKey)) {
            const primaryId = seenLogicalKeys.get(logicalKey)!;
            logicalDuplicates.push({
              primaryId,
              duplicateId: id,
              reason: `Matching key: "${logicalKey}"`,
            });
          } else {
            seenLogicalKeys.set(logicalKey, id);
          }
        }
      });

      reports.push({
        collection: colDef.name,
        totalDocuments: snap.docs.length,
        duplicateIds,
        logicalDuplicates,
      });
    } catch (err: any) {
      console.warn(`[Duplicate Audit Notice] Could not read collection ${colDef.name}:`, err.message);
    }
  }

  return reports;
}
