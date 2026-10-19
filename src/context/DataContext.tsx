import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  SiteSettings,
  SiteContent,
  ServiceCategory,
  Service,
  ServiceArea,
  CustomerRequest,
  ReviewItem,
  RequestStatus,
  ServiceProvider,
  IntegrationConfig,
  isValidStatusTransition,
} from '../types';
import { calculateDistanceKm, estimateDriveMinutes } from '../utils/geoUtils';
import { runIdempotentMigration, removeUndefinedFields, MigrationSummary } from '../utils/migration';
import { DEFAULT_SITE_SETTINGS, DEFAULT_SITE_CONTENT, DEFAULT_SERVICE_CATEGORIES, DEFAULT_SERVICES, DEFAULT_SERVICE_AREAS } from '../data/defaults';
import { db, auth, isFirebaseConfigured, handleFirestoreError, OperationType, verifyOwnerAuthorization } from '../config/firebase';
import { collection, doc, setDoc, onSnapshot, deleteDoc, runTransaction, Unsubscribe } from 'firebase/firestore';

interface DataContextType {
  settings: SiteSettings;
  content: SiteContent;
  categories: ServiceCategory[];
  services: Service[];
  areas: ServiceArea[];
  requests: CustomerRequest[];
  reviews: ReviewItem[];
  providers: ServiceProvider[];
  integrations: IntegrationConfig[];
  
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  migrationSummary: MigrationSummary | null;
  runMigration: (options?: { dryRun?: boolean }) => Promise<MigrationSummary>;
  retryConnection: () => Promise<void>;
  resetToDefaults: () => Promise<void>;

  // Providers
  addProvider: (provider: Omit<ServiceProvider, 'id' | 'createdAt'>) => Promise<string>;
  updateProvider: (id: string, updates: Partial<ServiceProvider>) => Promise<void>;
  deleteProvider: (id: string) => Promise<{ success: boolean; reason?: string }>;
  matchProviders: (
    serviceId: string,
    areaId?: string,
    options?: {
      targetCoords?: { lat: number; lng: number };
      date?: string;
      additionalServiceIds?: string[];
    }
  ) => (ServiceProvider & { estimatedDistanceKm?: number; distanceMatchBasis: 'coordinates' | 'area' })[];

  // Integrations
  updateIntegration: (id: string, updates: Partial<IntegrationConfig>) => Promise<void>;

  // Pricing & Publication Workflow
  approveServicePrice: (id: string, approvedMin: number, approvedMax: number, adminEmail?: string) => Promise<void>;
  publishService: (id: string, isPublished: boolean, isBooking?: boolean, adminEmail?: string) => Promise<void>;
  rejectServicePrice: (id: string, reason?: string, adminEmail?: string) => Promise<void>;
  assignRequestProvider: (requestId: string, providerId: string, travelFee?: number, suppliesFee?: number, labFee?: number) => Promise<void>;
  
  // Settings & Content
  updateSettings: (newSettings: Partial<SiteSettings>) => Promise<void>;
  updateContent: (newContent: Partial<SiteContent>) => Promise<void>;
  
  // Categories
  addCategory: (cat: Omit<ServiceCategory, 'id'>) => Promise<string>;
  updateCategory: (id: string, updates: Partial<ServiceCategory>) => Promise<void>;
  deleteCategory: (id: string) => Promise<{ success: boolean; reason?: string }>;
  
  // Services
  addService: (srv: Omit<Service, 'id'>) => Promise<string>;
  updateService: (id: string, updates: Partial<Service>, adminEmail?: string) => Promise<void>;
  approveAndPublishService: (
    id: string,
    approvedMin: number,
    approvedMax: number,
    isPublic: boolean,
    isBooking: boolean,
    adminEmail?: string
  ) => Promise<void>;
  toggleServiceActive: (id: string) => Promise<void>;
  deleteService: (id: string) => Promise<{ success: boolean; reason?: string }>;
  
  // Areas
  addArea: (area: Omit<ServiceArea, 'id'>) => Promise<string>;
  updateArea: (id: string, updates: Partial<ServiceArea>) => Promise<void>;
  deleteArea: (id: string) => Promise<{ success: boolean; reason?: string }>;
  
  // Requests
  createCustomerRequest: (req: Omit<CustomerRequest, 'id' | 'createdAt' | 'status' | 'currency'>) => Promise<string>;
  retryWhatsAppNotification: (
    orderId: string,
    retryTarget?: 'both' | 'recipient_a' | 'recipient_b'
  ) => Promise<any>;
  retryTelegramNotification: (orderId: string) => Promise<any>;
  updateRequestStatus: (
    id: string,
    newStatus: RequestStatus,
    note?: string,
    confirmedPrice?: number,
    changedBy?: string
  ) => Promise<void>;
  updateRequestNearestProvidersToggle: (id: string, enabled: boolean) => Promise<void>;
  updateRequestConfirmedPrice: (id: string, newPrice: number, adminEmail?: string) => Promise<void>;
  updateRequestAdminNotes: (id: string, notes: string) => Promise<void>;
  updateRequestQuote: (
    id: string,
    quoteUpdates: Partial<CustomerRequest['quote']>,
    confirmedPrice?: number,
    travelFee?: number,
    note?: string,
    changedBy?: string
  ) => Promise<void>;
  deleteCustomerRequest: (id: string) => Promise<{ success: boolean; reason?: string }>;
  
  // Reviews
  addReview: (rev: Omit<ReviewItem, 'id'>) => Promise<string>;
  updateReview: (id: string, updates: Partial<ReviewItem>) => Promise<void>;
  deleteReview: (id: string) => Promise<{ success: boolean; reason?: string }>;

  // Audit
  recordAuditLog: (
    action: string,
    targetCollection: string,
    targetId: string,
    details: string,
    actorEmail?: string
  ) => Promise<void>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [content, setContent] = useState<SiteContent>(DEFAULT_SITE_CONTENT);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [providers, setProviders] = useState<ServiceProvider[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isError, setIsError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [migrationSummary, setMigrationSummary] = useState<MigrationSummary | null>(null);
  const [isUserAdmin, setIsUserAdmin] = useState<boolean>(false);

  // Track auth state to attach admin-only snapshot listeners safely
  useEffect(() => {
    if (auth) {
      const unsub = auth.onAuthStateChanged(async (user) => {
        if (user && user.email) {
          const isAuthorized = await verifyOwnerAuthorization(user);
          setIsUserAdmin(isAuthorized);
        } else {
          setIsUserAdmin(false);
        }
      });
      return () => unsub();
    }
  }, []);

  // Controlled migration execution
  const runMigration = useCallback(async (options?: { dryRun?: boolean }) => {
    const summary = await runIdempotentMigration(options);
    setMigrationSummary(summary);
    return summary;
  }, []);

  // Attach Public Firestore real-time listeners on boot
  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      setIsError(true);
      setErrorMessage('مشروع Firebase لم يتم إعداده أو ربطه بالشكل الصحيح. | Firebase project is not configured.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setIsError(false);
    setErrorMessage(null);

    const unsubSettings = onSnapshot(doc(db, 'siteSettings', 'global'), (snapshot) => {
      if (snapshot.exists()) {
        setSettings((prev) => ({ ...prev, ...snapshot.data() } as SiteSettings));
      }
    }, (err) => console.error('[Firestore Client Error] siteSettings listener notice:', err));

    const unsubContent = onSnapshot(doc(db, 'siteContent', 'global'), (snapshot) => {
      if (snapshot.exists()) {
        setContent((prev) => ({ ...prev, ...snapshot.data() } as SiteContent));
      }
    }, (err) => console.error('[Firestore Client Error] siteContent listener notice:', err));

    const unsubCat = onSnapshot(collection(db, 'serviceCategories'), (snapshot) => {
      const map = new Map<string, ServiceCategory>();
      snapshot.docs.forEach(doc => map.set(doc.id, { id: doc.id, ...doc.data() } as ServiceCategory));
      const fetched = Array.from(map.values());
      fetched.sort((a, b) => (a.order || 0) - (b.order || 0));
      if (fetched.length > 0) {
        setCategories(fetched);
      } else {
        console.warn('[Firestore Notice] serviceCategories collection in (default) database is empty.');
        setCategories(DEFAULT_SERVICE_CATEGORIES);
      }
    }, (err) => {
      console.error('[Firestore Client Error] serviceCategories listener notice:', err);
      setCategories(DEFAULT_SERVICE_CATEGORIES);
    });

    const unsubServices = onSnapshot(collection(db, 'services'), (snapshot) => {
      const map = new Map<string, Service>();
      snapshot.docs.forEach(doc => map.set(doc.id, { id: doc.id, ...doc.data() } as Service));
      const fetched = Array.from(map.values());
      fetched.sort((a, b) => (a.order || 0) - (b.order || 0));
      if (fetched.length > 0) {
        setServices(fetched);
      } else {
        console.warn('[Firestore Notice] services collection in (default) database is empty. Using defaults.');
        setServices(DEFAULT_SERVICES);
      }
    }, (err) => {
      console.error('[Firestore Client Error] services listener notice:', err);
      setServices(DEFAULT_SERVICES);
    });

    const unsubAreas = onSnapshot(collection(db, 'serviceAreas'), (snapshot) => {
      const map = new Map<string, ServiceArea>();
      snapshot.docs.forEach(doc => map.set(doc.id, { id: doc.id, ...doc.data() } as ServiceArea));
      const fetched = Array.from(map.values());
      fetched.sort((a, b) => (a.order || 0) - (b.order || 0));
      if (fetched.length > 0) {
        setAreas(fetched);
      } else {
        console.warn('[Firestore Notice] serviceAreas collection in (default) database is empty. Using defaults.');
        setAreas(DEFAULT_SERVICE_AREAS);
      }
    }, (err) => {
      console.error('[Firestore Client Error] serviceAreas listener notice:', err);
      setAreas(DEFAULT_SERVICE_AREAS);
    });

    const unsubReviews = onSnapshot(collection(db, 'reviews'), (snapshot) => {
      const map = new Map<string, ReviewItem>();
      snapshot.docs.forEach(doc => map.set(doc.id, { id: doc.id, ...doc.data() } as ReviewItem));
      const fetched = Array.from(map.values());
      fetched.sort((a, b) => (a.order || 0) - (b.order || 0));
      setReviews(fetched);
    }, (err) => console.error('[Firestore Client Error] reviews listener notice:', err));

    setIsLoading(false);

    return () => {
      unsubSettings();
      unsubContent();
      unsubCat();
      unsubServices();
      unsubAreas();
      unsubReviews();
    };
  }, []);

  // Attach Admin-Only Firestore real-time listeners strictly when admin user is authenticated
  useEffect(() => {
    if (!isFirebaseConfigured || !db || !isUserAdmin) {
      setProviders([]);
      setIntegrations([]);
      setRequests([]);
      return;
    }

    let unsubProviders: Unsubscribe | undefined;
    let unsubIntegrations: Unsubscribe | undefined;
    let unsubRequests: Unsubscribe | undefined;

    try {
      unsubProviders = onSnapshot(collection(db, 'serviceProviders'), (snapshot) => {
        const map = new Map<string, ServiceProvider>();
        snapshot.docs.forEach(doc => map.set(doc.id, { id: doc.id, ...doc.data() } as ServiceProvider));
        setProviders(Array.from(map.values()));
      }, (err) => console.log('serviceProviders admin listener notice:', err));

      unsubIntegrations = onSnapshot(collection(db, 'integrations'), (snapshot) => {
        const map = new Map<string, IntegrationConfig>();
        snapshot.docs.forEach(doc => map.set(doc.id, { id: doc.id, ...doc.data() } as IntegrationConfig));
        setIntegrations(Array.from(map.values()));
      }, (err) => console.log('integrations admin listener notice:', err));

      unsubRequests = onSnapshot(collection(db, 'customerRequests'), (snapshot) => {
        const map = new Map<string, CustomerRequest>();
        snapshot.docs.forEach(doc => map.set(doc.id, { id: doc.id, ...doc.data() } as CustomerRequest));
        const fetched = Array.from(map.values());
        fetched.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setRequests(fetched);
      }, (err) => console.log('customerRequests admin listener notice:', err));
    } catch (err) {
      console.warn('Admin listener setup error:', err);
    }

    return () => {
      if (unsubProviders) unsubProviders();
      if (unsubIntegrations) unsubIntegrations();
      if (unsubRequests) unsubRequests();
    };
  }, [isUserAdmin]);

  const retryConnection = async () => {
    setIsLoading(true);
    setIsError(false);
    setErrorMessage(null);
    setIsLoading(false);
  };

  const resetToDefaults = async () => {
    await runMigration({ dryRun: false });
  };

  const updateSettings = async (newSettings: Partial<SiteSettings>) => {
    const updated = { ...settings, ...newSettings, updatedAt: new Date().toISOString() };
    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'siteSettings', 'global'), removeUndefinedFields(updated), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'siteSettings/global');
      }
    }
    setSettings(updated);
  };

  const updateContent = async (newContent: Partial<SiteContent>) => {
    const updated = { ...content, ...newContent, updatedAt: new Date().toISOString() };
    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'siteContent', 'global'), removeUndefinedFields(updated), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'siteContent/global');
      }
    }
    setContent(updated);
  };

  const addCategory = async (cat: Omit<ServiceCategory, 'id'>): Promise<string> => {
    const id = `cat-${Date.now()}`;
    const newCategory: ServiceCategory = { ...cat, id, updatedAt: new Date().toISOString() };
    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'serviceCategories', id), removeUndefinedFields(newCategory), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `serviceCategories/${id}`);
      }
    }
    setCategories(prev => [...prev.filter(c => c.id !== id), newCategory]);
    return id;
  };

  const updateCategory = async (id: string, updates: Partial<ServiceCategory>) => {
    const existingCat = categories.find(c => c.id === id);
    const updatedCat = { ...existingCat, ...updates, id, updatedAt: new Date().toISOString() } as ServiceCategory;

    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'serviceCategories', id), removeUndefinedFields(updatedCat), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `serviceCategories/${id}`);
      }
    }
    setCategories(prev => prev.map(c => (c.id === id ? updatedCat : c)));
  };

  const deleteCategory = async (id: string): Promise<{ success: boolean; reason?: string }> => {
    const cat = categories.find(c => c.id === id);
    const referencedCount = services.filter(s => s.categoryId === id).length;
    if (referencedCount > 0) {
      return {
        success: false,
        reason: `لا يمكن حذف التصنيف لأنه مستخدم في ${referencedCount} من الخدمات. يمكنك إلغاء تفعيله بدلاً من حذفه. | Cannot delete category: referenced by ${referencedCount} services. Deactivate it instead.`,
      };
    }
    if (isFirebaseConfigured && db) {
      try {
        await deleteDoc(doc(db, 'serviceCategories', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `serviceCategories/${id}`);
      }
    }
    setCategories(prev => prev.filter(c => c.id !== id));
    await recordAuditLog('delete_category', 'serviceCategories', id, `Deleted category: ${cat?.nameAr || id}`);
    return { success: true };
  };

  const recordAuditLog = async (
    action: string,
    targetCollection: string,
    targetId: string,
    details: string,
    actorEmail: string = 'Authorized Owner'
  ) => {
    const logId = `log-${Date.now()}`;
    const effectiveActor = auth?.currentUser?.email || actorEmail;
    const logEntry = {
      actorEmail: effectiveActor,
      action,
      targetCollection,
      targetId,
      details,
      timestamp: new Date().toISOString(),
    };
    if (isFirebaseConfigured && db && auth?.currentUser) {
      try {
        await setDoc(doc(db, 'auditLogs', logId), removeUndefinedFields(logEntry));
      } catch (err: any) {
        console.warn('Audit log write error on Firestore:', err?.message || err);
      }
    }
  };

  const addService = async (srv: Omit<Service, 'id'>): Promise<string> => {
    const id = `srv-${Date.now()}`;
    const initialVisibility = srv.isPubliclyVisible ?? srv.isPubliclyPublished ?? false;
    const newService: Service = {
      ...srv,
      id,
      pricingStatus: srv.pricingStatus || 'draft',
      serviceStatus: srv.serviceStatus || (initialVisibility ? 'active' : 'draft'),
      isPubliclyVisible: initialVisibility,
      isPubliclyPublished: initialVisibility,
      isBookingEnabled: srv.isBookingEnabled || false,
      updatedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'services', id), removeUndefinedFields(newService), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `services/${id}`);
      }
    }
    setServices(prev => [newService, ...prev.filter(s => s.id !== id)]);
    await recordAuditLog('create_service', 'services', id, `Created service: ${srv.nameAr}`);
    return id;
  };

  const updateService = async (id: string, updates: Partial<Service>, adminEmail?: string) => {
    const current = services.find(s => s.id === id);
    let patch = { ...updates, updatedAt: new Date().toISOString(), lastUpdated: new Date().toISOString() };

    if (updates.isPubliclyPublished !== undefined && updates.isPubliclyVisible === undefined) {
      patch.isPubliclyVisible = updates.isPubliclyPublished;
    }
    if (updates.isPubliclyVisible !== undefined && updates.isPubliclyPublished === undefined) {
      patch.isPubliclyPublished = updates.isPubliclyVisible;
    }

    const isPriceChanged =
      (updates.draftPriceMin !== undefined && updates.draftPriceMin !== current?.draftPriceMin) ||
      (updates.draftPriceMax !== undefined && updates.draftPriceMax !== current?.draftPriceMax);

    if (isPriceChanged && current?.pricingStatus === 'approved' && updates.pricingStatus === undefined) {
      patch.pricingStatus = 'under_review';
    }

    const fullUpdatedService = { ...current, ...patch, id } as Service;

    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'services', id), removeUndefinedFields(fullUpdatedService), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `services/${id}`);
      }
    }

    setServices(prev => prev.map(s => (s.id === id ? fullUpdatedService : s)));

    await recordAuditLog(
      'update_service',
      'services',
      id,
      `Updated service fields${isPriceChanged ? ' (Pricing returned to under_review)' : ''}`,
      adminEmail
    );
  };

  const approveAndPublishService = async (
    id: string,
    approvedMin: number,
    approvedMax: number,
    isPublic: boolean,
    isBooking: boolean,
    adminEmail?: string
  ) => {
    const current = services.find(s => s.id === id);
    const patch: Partial<Service> = {
      approvedPriceMin: approvedMin,
      approvedPriceMax: approvedMax,
      pricingStatus: 'approved',
      serviceStatus: isPublic ? 'active' : 'draft',
      isPubliclyVisible: isPublic,
      isPubliclyPublished: isPublic,
      isBookingEnabled: isBooking,
      responsibleAdmin: adminEmail || 'Authorized Owner',
      lastUpdated: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const fullService = { ...current, ...patch, id } as Service;

    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'services', id), removeUndefinedFields(fullService), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `services/${id}`);
      }
    }

    setServices(prev => prev.map(s => (s.id === id ? fullService : s)));

    await recordAuditLog(
      'approve_publish_pricing',
      'services',
      id,
      `Approved price range ${approvedMin}-${approvedMax} EGP and set visible=${isPublic}, booking=${isBooking}`,
      adminEmail
    );
  };

  const toggleServiceActive = async (id: string) => {
    const target = services.find(s => s.id === id);
    if (target) {
      const nextActive = !target.active;
      await updateService(id, {
        active: nextActive,
        serviceStatus: nextActive ? 'active' : 'inactive',
      });
    }
  };

  const deleteService = async (id: string): Promise<{ success: boolean; reason?: string }> => {
    const srv = services.find(s => s.id === id);
    const referencedInRequests = requests.filter(r => r.serviceId === id).length;
    if (referencedInRequests > 0) {
      return {
        success: false,
        reason: `لا يمكن حذف الخدمة لوجود ${referencedInRequests} طلب مرتبط بها في سجل الحالات. تم تعطيل الخدمة لحفظ السجلات التاريخية. | Cannot delete service: referenced by ${referencedInRequests} requests. Disable it instead.`,
      };
    }
    if (isFirebaseConfigured && db) {
      try {
        await deleteDoc(doc(db, 'services', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `services/${id}`);
      }
    }
    setServices(prev => prev.filter(s => s.id !== id));
    await recordAuditLog('delete_service', 'services', id, `Deleted service: ${srv?.nameAr || id}`);
    return { success: true };
  };

  const addArea = async (area: Omit<ServiceArea, 'id'>): Promise<string> => {
    const id = `area-${Date.now()}`;
    const newArea: ServiceArea = { ...area, id, updatedAt: new Date().toISOString() };
    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'serviceAreas', id), removeUndefinedFields(newArea), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `serviceAreas/${id}`);
      }
    }
    setAreas(prev => [...prev.filter(a => a.id !== id), newArea]);
    return id;
  };

  const updateArea = async (id: string, updates: Partial<ServiceArea>) => {
    const current = areas.find(a => a.id === id);
    const updated = { ...current, ...updates, id, updatedAt: new Date().toISOString() } as ServiceArea;

    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'serviceAreas', id), removeUndefinedFields(updated), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `serviceAreas/${id}`);
      }
    }
    setAreas(prev => prev.map(a => (a.id === id ? updated : a)));
  };

  const deleteArea = async (id: string): Promise<{ success: boolean; reason?: string }> => {
    const area = areas.find(a => a.id === id);
    const referencedCount = requests.filter(r => r.areaId === id).length;
    if (referencedCount > 0) {
      return {
        success: false,
        reason: `لا يمكن حذف المنطقة لوجود ${referencedCount} طلب مرتبط بها. تم تعطيل المنطقة بدلاً من الحذف لحفظ السجلات. | Cannot delete area: referenced by ${referencedCount} requests. Deactivate it instead.`,
      };
    }
    if (isFirebaseConfigured && db) {
      try {
        await deleteDoc(doc(db, 'serviceAreas', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `serviceAreas/${id}`);
      }
    }
    setAreas(prev => prev.filter(a => a.id !== id));
    await recordAuditLog('delete_area', 'serviceAreas', id, `Deleted service area: ${area?.nameAr || id}`);
    return { success: true };
  };

  const matchProviders = (
    serviceId: string,
    areaId?: string,
    options?: {
      targetCoords?: { lat: number; lng: number };
      date?: string;
      additionalServiceIds?: string[];
    }
  ): (ServiceProvider & { estimatedDistanceKm?: number; distanceMatchBasis: 'coordinates' | 'area' })[] => {
    const area = areaId ? areas.find(a => a.id === areaId) : undefined;
    const targetCoords = options?.targetCoords || area?.coordinates;
    const allRequiredServiceIds = [serviceId, ...(options?.additionalServiceIds || [])].filter(Boolean);

    const candidates = providers.filter(p => {
      if (p.status !== 'active') return false;

      const canPerformServices =
        p.qualifiedServiceIds.length === 0 ||
        allRequiredServiceIds.some(sid => p.qualifiedServiceIds.includes(sid));
      if (!canPerformServices) return false;

      const coversArea = !areaId || p.serviceAreaIds.length === 0 || p.serviceAreaIds.includes(areaId);
      if (!coversArea) return false;

      if (options?.date && p.unavailableDates && p.unavailableDates.includes(options.date)) {
        return false;
      }

      return true;
    });

    const ranked = candidates.map(p => {
      let estimatedDistanceKm: number | undefined = undefined;
      let distanceMatchBasis: 'coordinates' | 'area' = 'area';

      if (targetCoords && p.coordinates) {
        estimatedDistanceKm = calculateDistanceKm(targetCoords, p.coordinates);
        distanceMatchBasis = 'coordinates';
      }

      return {
        ...p,
        estimatedDistanceKm,
        distanceMatchBasis,
      };
    });

    ranked.sort((a, b) => {
      if (a.estimatedDistanceKm !== undefined && b.estimatedDistanceKm !== undefined) {
        return a.estimatedDistanceKm - b.estimatedDistanceKm;
      }
      if (a.estimatedDistanceKm !== undefined) return -1;
      if (b.estimatedDistanceKm !== undefined) return 1;
      return a.name.localeCompare(b.name);
    });

    return ranked;
  };

  const createCustomerRequest = async (
    reqData: Omit<CustomerRequest, 'id' | 'createdAt' | 'status' | 'currency'>
  ): Promise<string> => {
    const timestampSuffix = Date.now().toString().slice(-6);
    const id = `ONS-${new Date().getFullYear()}-${timestampSuffix}`;
    const newRequest: CustomerRequest = {
      ...reqData,
      id,
      status: 'new',
      isNearestProvidersEnabled: false,
      currency: settings.currency || 'ج.م',
      createdAt: new Date().toISOString(),
      statusHistory: [
        {
          status: 'new',
          timestamp: new Date().toISOString(),
          changedBy: 'System (Customer Web Order)',
          note: 'تم إرسال الطلب واعتماده في قاعدة البيانات عبر الموقع',
        },
      ],
    };

    // 1. Persist to Firestore database
    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'customerRequests', id), removeUndefinedFields(newRequest));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `customerRequests/${id}`);
      }
    }

    setRequests(prev => [newRequest, ...prev.filter(r => r.id !== id)]);

    // 2. Recommend nearest eligible providers
    const topCandidates = matchProviders(newRequest.serviceId, newRequest.areaId, {
      targetCoords: newRequest.mapCoordinates,
      date: newRequest.preferredDate,
    }).slice(0, 3).map(p => ({
      id: p.id,
      name: p.name,
      specialtyAr: p.specialtyAr,
      specialtyEn: p.specialtyEn,
      phone: p.phone,
      agreedRate: p.agreedRate,
      estimatedDistanceKm: p.estimatedDistanceKm,
      driveTimeMinutes: p.estimatedDistanceKm ? estimateDriveMinutes(p.estimatedDistanceKm) : undefined,
      distanceMatchBasis: p.distanceMatchBasis,
      providerType: p.providerType,
    }));

    // 3. Automated Telegram notification
    let telegramLog: CustomerRequest['telegramNotificationLog'] = undefined;
    let telegramSent = false;
    try {
      const tgRes = await fetch('/api/telegram/notify-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order: {
            ...newRequest,
            paymentSettings: {
              instaPayAddress: settings.instaPayAddress,
              vodafoneCashNumber: settings.vodafoneCashNumber,
              beneficiaryName: settings.beneficiaryName,
            },
          },
          recommendedProviders: topCandidates,
        }),
      });
      const tgData = await tgRes.json().catch(() => ({}));
      telegramSent = Boolean(tgData.success);
      telegramLog = {
        status: tgData.status || (tgData.success ? 'sent' : 'failed'),
        lastAttemptAt: new Date().toISOString(),
        chatId: tgData.chatId,
        messageId: tgData.messageId,
        error: tgData.error,
        recommendedProvidersCount: topCandidates.length,
      };
    } catch (tgErr: any) {
      console.warn('Telegram notification server notice:', tgErr);
      telegramLog = {
        status: 'failed',
        lastAttemptAt: new Date().toISOString(),
        error: tgErr.message || 'Network error triggering server notification',
        recommendedProvidersCount: topCandidates.length,
      };
    }

    // 4. Automated WhatsApp notification
    let whatsappLog: CustomerRequest['whatsappNotificationLog'] = undefined;
    let whatsappSent = false;
    try {
      const notifyRes = await fetch('/api/whatsapp/notify-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: newRequest }),
      });
      const notifyData = await notifyRes.json().catch(() => ({}));
      whatsappSent = Boolean(notifyData.success);
      whatsappLog = {
        status: notifyData.overallStatus || (notifyData.success ? 'sent' : 'failed'),
        lastAttemptAt: new Date().toISOString(),
        overallError: notifyData.error,
        recipientA: notifyData.recipientA
          ? {
              recipientId: 'recipient_a',
              phone: notifyData.recipientA.phone || '',
              status: notifyData.recipientA.status || 'not_configured',
              messageId: notifyData.recipientA.messageId,
              error: notifyData.recipientA.error,
              timestamp: notifyData.recipientA.timestamp || new Date().toISOString(),
              attempts: 1,
            }
          : undefined,
        recipientB: notifyData.recipientB
          ? {
              recipientId: 'recipient_b',
              phone: notifyData.recipientB.phone || '',
              status: notifyData.recipientB.status || 'not_configured',
              messageId: notifyData.recipientB.messageId,
              error: notifyData.recipientB.error,
              timestamp: notifyData.recipientB.timestamp || new Date().toISOString(),
              attempts: 1,
            }
          : undefined,
      };
    } catch (notifyErr: any) {
      console.warn('Server WhatsApp notification error:', notifyErr);
      whatsappLog = {
        status: 'failed',
        lastAttemptAt: new Date().toISOString(),
        overallError: notifyErr.message || 'Network error triggering server notification',
      };
    }

    setRequests(prev =>
      prev.map(r =>
        r.id === id
          ? {
              ...r,
              telegramNotificationSent: telegramSent,
              telegramNotificationTimestamp: new Date().toISOString(),
              telegramNotificationLog: telegramLog,
              whatsappNotificationSent: whatsappSent,
              whatsappNotificationTimestamp: new Date().toISOString(),
              whatsappNotificationLog: whatsappLog,
            }
          : r
      )
    );

    if (isFirebaseConfigured && db && auth?.currentUser) {
      try {
        await setDoc(doc(db, 'customerRequests', id), removeUndefinedFields({
          telegramNotificationSent: telegramSent,
          telegramNotificationTimestamp: new Date().toISOString(),
          telegramNotificationLog: telegramLog,
          whatsappNotificationSent: whatsappSent,
          whatsappNotificationTimestamp: new Date().toISOString(),
          whatsappNotificationLog: whatsappLog,
        }), { merge: true });
      } catch (dbErr) {
        console.warn('Could not update customerRequest notification log in firestore:', dbErr);
      }
    }

    return id;
  };

  const retryWhatsAppNotification = async (
    orderId: string,
    retryTarget: 'both' | 'recipient_a' | 'recipient_b' = 'both'
  ): Promise<any> => {
    const targetOrder = requests.find(r => r.id === orderId);
    if (!targetOrder) {
      throw new Error(`Order ${orderId} not found in database.`);
    }

    const res = await fetch('/api/whatsapp/retry-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: targetOrder, retryTarget }),
    });

    const data = await res.json().catch(() => ({}));

    const logEntry: CustomerRequest['whatsappNotificationLog'] = {
      status: data.overallStatus || (data.success ? 'sent' : 'failed'),
      lastAttemptAt: new Date().toISOString(),
      overallError: data.error,
      recipientA: data.recipientA
        ? {
            recipientId: 'recipient_a',
            phone: data.recipientA.phone || '',
            status: data.recipientA.status || 'not_configured',
            messageId: data.recipientA.messageId,
            error: data.recipientA.error,
            timestamp: data.recipientA.timestamp || new Date().toISOString(),
            attempts: ((targetOrder.whatsappNotificationLog?.recipientA?.attempts || 0) + 1),
          }
        : targetOrder.whatsappNotificationLog?.recipientA,
      recipientB: data.recipientB
        ? {
            recipientId: 'recipient_b',
            phone: data.recipientB.phone || '',
            status: data.recipientB.status || 'not_configured',
            messageId: data.recipientB.messageId,
            error: data.recipientB.error,
            timestamp: data.recipientB.timestamp || new Date().toISOString(),
            attempts: ((targetOrder.whatsappNotificationLog?.recipientB?.attempts || 0) + 1),
          }
        : targetOrder.whatsappNotificationLog?.recipientB,
    };

    setRequests(prev =>
      prev.map(r =>
        r.id === orderId
          ? {
              ...r,
              whatsappNotificationSent: Boolean(data.success),
              whatsappNotificationTimestamp: new Date().toISOString(),
              whatsappNotificationLog: logEntry,
            }
          : r
      )
    );

    if (isFirebaseConfigured && db && auth?.currentUser) {
      try {
        await setDoc(doc(db, 'customerRequests', orderId), removeUndefinedFields({
          whatsappNotificationSent: Boolean(data.success),
          whatsappNotificationTimestamp: new Date().toISOString(),
          whatsappNotificationLog: logEntry,
        }), { merge: true });
      } catch (dbErr) {
        console.warn('Could not update customerRequest with retried whatsapp log in firestore:', dbErr);
      }
    }

    await recordAuditLog(
      'retry_whatsapp_notification',
      'customerRequests',
      orderId,
      `Retried WhatsApp notification (${retryTarget}) - Status: ${logEntry.status}`
    );

    return data;
  };

  const retryTelegramNotification = async (orderId: string): Promise<any> => {
    const targetOrder = requests.find(r => r.id === orderId);
    if (!targetOrder) {
      throw new Error(`Order ${orderId} not found in database.`);
    }

    const topCandidates = matchProviders(targetOrder.serviceId, targetOrder.areaId, {
      targetCoords: targetOrder.mapCoordinates,
      date: targetOrder.preferredDate,
    }).slice(0, 3).map(p => ({
      id: p.id,
      name: p.name,
      specialtyAr: p.specialtyAr,
      specialtyEn: p.specialtyEn,
      phone: p.phone,
      agreedRate: p.agreedRate,
      estimatedDistanceKm: p.estimatedDistanceKm,
      driveTimeMinutes: p.estimatedDistanceKm ? estimateDriveMinutes(p.estimatedDistanceKm) : undefined,
      distanceMatchBasis: p.distanceMatchBasis,
      providerType: p.providerType,
    }));

    const res = await fetch('/api/telegram/notify-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order: {
          ...targetOrder,
          paymentSettings: {
            instaPayAddress: settings.instaPayAddress,
            vodafoneCashNumber: settings.vodafoneCashNumber,
            beneficiaryName: settings.beneficiaryName,
          },
        },
        recommendedProviders: topCandidates,
      }),
    });

    const data = await res.json().catch(() => ({}));
    const tgLog: CustomerRequest['telegramNotificationLog'] = {
      status: data.status || (data.success ? 'sent' : 'failed'),
      lastAttemptAt: new Date().toISOString(),
      chatId: data.chatId,
      messageId: data.messageId,
      error: data.error,
      recommendedProvidersCount: topCandidates.length,
    };

    setRequests(prev =>
      prev.map(r =>
        r.id === orderId
          ? {
              ...r,
              telegramNotificationSent: Boolean(data.success),
              telegramNotificationTimestamp: new Date().toISOString(),
              telegramNotificationLog: tgLog,
            }
          : r
      )
    );

    if (isFirebaseConfigured && db && auth?.currentUser) {
      try {
        await setDoc(doc(db, 'customerRequests', orderId), removeUndefinedFields({
          telegramNotificationSent: Boolean(data.success),
          telegramNotificationTimestamp: new Date().toISOString(),
          telegramNotificationLog: tgLog,
        }), { merge: true });
      } catch (dbErr) {
        console.warn('Could not update customerRequest with retried telegram log in firestore:', dbErr);
      }
    }

    await recordAuditLog(
      'retry_telegram_notification',
      'customerRequests',
      orderId,
      `Retried Telegram notification - Status: ${tgLog.status}`
    );

    return data;
  };

  const updateRequestStatus = async (
    id: string,
    newStatus: RequestStatus,
    note?: string,
    confirmedPrice?: number,
    changedBy: string = 'المالك المعتمد (Owner)'
  ) => {
    const current = requests.find(r => r.id === id);
    if (!current) return;

    if (!isValidStatusTransition(current.status, newStatus)) {
      throw new Error(`انتقال غير مسموح به للحالة من «${current.status}» إلى «${newStatus}». ينص نظام التطبيق والقواعد الموثوقة على عدم التراجع عن الحالات المتقدمة أو تعديل الحالات النهائية.`);
    }

    const historyEntry = {
      status: newStatus,
      timestamp: new Date().toISOString(),
      changedBy,
      note: note || `تعديل الحالة إلى: ${newStatus}`,
    };

    let priceNote = '';
    if (confirmedPrice !== undefined && confirmedPrice !== current.confirmedPrice) {
      priceNote = ` | السعر المعتمد النهائي: ${confirmedPrice} ج.م (السابق: ${current.confirmedPrice || 0} ج.م)`;
      historyEntry.note += priceNote;
    }

    const updatedReq: CustomerRequest = {
      ...current,
      status: newStatus,
      updatedAt: new Date().toISOString(),
      confirmedPrice: confirmedPrice !== undefined ? confirmedPrice : current.confirmedPrice,
      statusHistory: [...(current.statusHistory || []), historyEntry],
    };

    if (isFirebaseConfigured && db && auth?.currentUser) {
      try {
        await setDoc(doc(db, 'customerRequests', id), removeUndefinedFields(updatedReq), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `customerRequests/${id}`);
      }
    }

    setRequests(prev => prev.map(r => (r.id === id ? updatedReq : r)));
    await recordAuditLog(
      'update_request_status',
      'customerRequests',
      id,
      `Updated status to ${newStatus}${priceNote}`,
      changedBy
    );
  };

  const updateRequestNearestProvidersToggle = async (id: string, enabled: boolean) => {
    const current = requests.find(r => r.id === id);
    if (!current) return;

    const updatedReq: CustomerRequest = {
      ...current,
      isNearestProvidersEnabled: enabled,
      updatedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured && db && auth?.currentUser) {
      try {
        await setDoc(
          doc(db, 'customerRequests', id),
          removeUndefinedFields({ isNearestProvidersEnabled: enabled, updatedAt: new Date().toISOString() }),
          { merge: true }
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `customerRequests/${id}`);
      }
    }

    setRequests(prev => prev.map(r => (r.id === id ? updatedReq : r)));
    await recordAuditLog(
      'toggle_nearest_providers',
      'customerRequests',
      id,
      enabled ? 'ميزة ترشيح أقرب الممارسين: تم التفعيل' : 'ميزة ترشيح أقرب الممارسين: تم التعطيل'
    );
  };

  const updateRequestConfirmedPrice = async (
    id: string,
    newPrice: number,
    adminEmail: string = 'المالك المعتمد (Owner)'
  ) => {
    const current = requests.find(r => r.id === id);
    if (!current) return;

    if (current.confirmedPrice !== undefined && current.confirmedPrice !== null) {
      throw new Error(`السعر المعتمد النهائي محدد مسبقاً (${current.confirmedPrice} ج.م) ومحمي من إعادة التعديل.`);
    }

    if (typeof newPrice !== 'number' || isNaN(newPrice) || newPrice <= 0) {
      throw new Error('السعر المعتمد النهائي يجب أن يكون رقماً صالحاً وموجباً (أكبر من صفر).');
    }

    const now = new Date().toISOString();
    const historyEntry = {
      status: current.status,
      timestamp: now,
      changedBy: adminEmail,
      note: `اعتماد السعر المعتمد النهائي: ${newPrice} ج.م`,
    };

    const updatedHistory = [...(current.statusHistory || []), historyEntry];

    if (isFirebaseConfigured && db && auth?.currentUser) {
      try {
        const docRef = doc(db, 'customerRequests', id);
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(docRef);
          if (!snap.exists()) throw new Error('الطلب غير موجود.');
          const data = snap.data();
          if (data.confirmedPrice !== undefined && data.confirmedPrice !== null) {
            throw new Error(`السعر المعتمد النهائي محدد مسبقاً (${data.confirmedPrice} ج.م) ومحمي من إعادة التعديل.`);
          }
          transaction.update(docRef, {
            confirmedPrice: newPrice,
            updatedAt: now,
            statusHistory: updatedHistory,
          });
        });
      } catch (err: any) {
        handleFirestoreError(err, OperationType.UPDATE, `customerRequests/${id}`);
        throw err;
      }
    }

    const updatedReq: CustomerRequest = {
      ...current,
      confirmedPrice: newPrice,
      updatedAt: now,
      statusHistory: updatedHistory,
    };

    setRequests(prev => prev.map(r => (r.id === id ? updatedReq : r)));
    await recordAuditLog(
      'update_confirmed_price',
      'customerRequests',
      id,
      `Confirmed final price: ${newPrice} EGP`,
      adminEmail
    );
  };

  const updateRequestAdminNotes = async (id: string, adminNotes: string) => {
    const current = requests.find(r => r.id === id);
    if (!current) return;

    const updated = { ...current, adminNotes, updatedAt: new Date().toISOString() };

    if (isFirebaseConfigured && db && auth?.currentUser) {
      try {
        await setDoc(doc(db, 'customerRequests', id), removeUndefinedFields({ adminNotes, updatedAt: new Date().toISOString() }), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `customerRequests/${id}`);
      }
    }

    setRequests(prev => prev.map(r => (r.id === id ? updated : r)));
  };

  const updateRequestQuote = async (
    id: string,
    quoteUpdates: Partial<CustomerRequest['quote']>,
    confirmedPrice?: number,
    travelFee?: number,
    note?: string,
    changedBy: string = 'المالك المعتمد (Owner)'
  ) => {
    const current = requests.find(r => r.id === id);
    if (!current) return;

    const currentQuote = current.quote || {
      serviceFee: { amount: current.confirmedPrice, isPending: current.confirmedPrice === undefined },
      suppliesFee: { amount: 0, isPending: false },
      labThirdPartyFee: { amount: 0, isPending: false },
      transportationFee: { amount: current.travelFee, isPending: current.travelFee === undefined },
      totalConfirmedAmount: current.confirmedPrice,
      isTotalPending: current.confirmedPrice === undefined,
      customerAcceptanceStatus: 'pending',
    };

    const mergedQuote = { ...currentQuote, ...quoteUpdates };
    const historyEntry = {
      status: current.status,
      timestamp: new Date().toISOString(),
      changedBy,
      note: note || `تحديث تفاصيل عرض السعر المخصص والتكاليف المنفصلة`,
    };

    const updatedReq: CustomerRequest = {
      ...current,
      quote: mergedQuote,
      confirmedPrice: confirmedPrice !== undefined ? confirmedPrice : current.confirmedPrice,
      travelFee: travelFee !== undefined ? travelFee : current.travelFee,
      updatedAt: new Date().toISOString(),
      statusHistory: [...(current.statusHistory || []), historyEntry],
    };

    if (isFirebaseConfigured && db && auth?.currentUser) {
      try {
        await setDoc(doc(db, 'customerRequests', id), removeUndefinedFields(updatedReq), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `customerRequests/${id}`);
      }
    }

    setRequests(prev => prev.map(r => (r.id === id ? updatedReq : r)));
    await recordAuditLog('update_request_quote', 'customerRequests', id, note || 'Updated itemized quote breakdown', changedBy);
  };

  const addReview = async (rev: Omit<ReviewItem, 'id'>): Promise<string> => {
    const id = `rev-${Date.now()}`;
    const newReview: ReviewItem = { ...rev, id, updatedAt: new Date().toISOString() };
    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'reviews', id), removeUndefinedFields(newReview), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `reviews/${id}`);
      }
    }
    setReviews(prev => [newReview, ...prev.filter(r => r.id !== id)]);
    return id;
  };

  const updateReview = async (id: string, updates: Partial<ReviewItem>) => {
    const current = reviews.find(r => r.id === id);
    const updated = { ...current, ...updates, id, updatedAt: new Date().toISOString() } as ReviewItem;

    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'reviews', id), removeUndefinedFields(updated), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `reviews/${id}`);
      }
    }
    setReviews(prev => prev.map(r => (r.id === id ? updated : r)));
  };

  const deleteReview = async (id: string): Promise<{ success: boolean; reason?: string }> => {
    const rev = reviews.find(r => r.id === id);
    if (isFirebaseConfigured && db) {
      try {
        await deleteDoc(doc(db, 'reviews', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `reviews/${id}`);
      }
    }
    setReviews(prev => prev.filter(r => r.id !== id));
    await recordAuditLog('delete_review', 'reviews', id, `Deleted review by ${rev?.authorNameAr || id}`);
    return { success: true };
  };

  const deleteCustomerRequest = async (id: string): Promise<{ success: boolean; reason?: string }> => {
    const req = requests.find(r => r.id === id);
    if (req && req.status === 'completed') {
      return {
        success: false,
        reason: 'لا يمكن حذف الطلبات المكتملة بنجاح حفاظاً على سلامة السجلات المالية والإدارية.',
      };
    }
    if (isFirebaseConfigured && db) {
      try {
        await deleteDoc(doc(db, 'customerRequests', id));
      } catch (err: any) {
        handleFirestoreError(err, OperationType.DELETE, `customerRequests/${id}`);
        return { success: false, reason: err.message || 'تعذر حذف الطلب من قاعدة البيانات.' };
      }
    }
    setRequests(prev => prev.filter(r => r.id !== id));
    await recordAuditLog('delete_customer_request', 'customerRequests', id, `Deleted customer request #${id} (${req?.customerName || ''})`);
    return { success: true };
  };

  const addProvider = async (provider: Omit<ServiceProvider, 'id' | 'createdAt'>): Promise<string> => {
    const id = `prov-${Date.now()}`;
    const newProvider: ServiceProvider = {
      ...provider,
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const sanitizedDoc = removeUndefinedFields(newProvider);
    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'serviceProviders', id), sanitizedDoc, { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `serviceProviders/${id}`);
      }
    }
    setProviders(prev => [newProvider, ...prev.filter(p => p.id !== id)]);
    await recordAuditLog('add_provider', 'serviceProviders', id, `Added provider: ${newProvider.name}`);
    return id;
  };

  const updateProvider = async (id: string, updates: Partial<ServiceProvider>) => {
    const current = providers.find(p => p.id === id);
    const updated = { ...current, ...updates, id, updatedAt: new Date().toISOString() } as ServiceProvider;
    const sanitizedDoc = removeUndefinedFields(updated);

    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'serviceProviders', id), sanitizedDoc, { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `serviceProviders/${id}`);
      }
    }
    setProviders(prev => prev.map(p => (p.id === id ? updated : p)));
    await recordAuditLog('update_provider', 'serviceProviders', id, `Updated provider info`);
  };

  const deleteProvider = async (id: string): Promise<{ success: boolean; reason?: string }> => {
    const prov = providers.find(p => p.id === id);
    const activeAssignedRequests = requests.filter(r => r.assignedProviderId === id && r.status !== 'cancelled' && r.status !== 'completed').length;
    if (activeAssignedRequests > 0) {
      return {
        success: false,
        reason: `لا يمكن حذف الممارس لوجود ${activeAssignedRequests} طلب نشط معين له. يرجى إعادة تعيين الطلبات أولاً. | Cannot delete provider: assigned to ${activeAssignedRequests} active requests. Reassign requests first.`,
      };
    }
    if (isFirebaseConfigured && db) {
      try {
        await deleteDoc(doc(db, 'serviceProviders', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `serviceProviders/${id}`);
      }
    }
    setProviders(prev => prev.filter(p => p.id !== id));
    await recordAuditLog('delete_provider', 'serviceProviders', id, `Deleted provider: ${prov?.name || id}`);
    return { success: true };
  };

  const updateIntegration = async (id: string, updates: Partial<IntegrationConfig>) => {
    const current = integrations.find(i => i.id === id);
    const updated = { ...current, ...updates, id, updatedAt: new Date().toISOString() } as IntegrationConfig;

    if (isFirebaseConfigured && db) {
      try {
        await setDoc(doc(db, 'integrations', id), removeUndefinedFields(updated), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `integrations/${id}`);
      }
    }
    setIntegrations(prev => prev.map(i => (i.id === id ? updated : i)));
    await recordAuditLog('update_integration', 'integrations', id, `Updated integration config: ${id}`);
  };

  const approveServicePrice = async (
    id: string,
    approvedMin: number,
    approvedMax: number,
    adminEmail: string = 'Authorized Owner'
  ) => {
    const updates: Partial<Service> = {
      approvedPriceMin: approvedMin,
      approvedPriceMax: approvedMax,
      pricingStatus: 'approved',
      updatedAt: new Date().toISOString(),
    };
    await updateService(id, updates, adminEmail);
    await recordAuditLog(
      'approve_service_price',
      'services',
      id,
      `Approved price range: ${approvedMin}–${approvedMax} EGP`,
      adminEmail
    );
  };

  const publishService = async (
    id: string,
    isPublished: boolean,
    isBooking: boolean = true,
    adminEmail: string = 'Authorized Owner'
  ) => {
    const srv = services.find(s => s.id === id);
    const updates: Partial<Service> = {
      isPubliclyPublished: isPublished,
      isPubliclyVisible: isPublished,
      isBookingEnabled: isBooking,
      pricingStatus: isPublished ? 'published' : (srv?.pricingStatus === 'published' ? 'approved' : srv?.pricingStatus),
      serviceStatus: isPublished ? 'active' : 'draft',
      active: isPublished,
      updatedAt: new Date().toISOString(),
    };
    await updateService(id, updates, adminEmail);
    await recordAuditLog(
      'publish_service',
      'services',
      id,
      `Set public publication: ${isPublished}, booking: ${isBooking}`,
      adminEmail
    );
  };

  const rejectServicePrice = async (
    id: string,
    reason?: string,
    adminEmail: string = 'Authorized Owner'
  ) => {
    const updates: Partial<Service> = {
      pricingStatus: 'rejected',
      isPubliclyPublished: false,
      isBookingEnabled: false,
      internalNotes: reason ? `مرفوض: ${reason}` : 'تم رفض التسعير للمراجعة وإعادة التقييم',
      updatedAt: new Date().toISOString(),
    };
    await updateService(id, updates, adminEmail);
    await recordAuditLog(
      'reject_service_price',
      'services',
      id,
      `Rejected service price: ${reason || 'Returned for re-evaluation'}`,
      adminEmail
    );
  };

  const assignRequestProvider = async (
    requestId: string,
    providerId: string,
    travelFee?: number,
    suppliesFee?: number,
    labFee?: number
  ) => {
    const provider = providers.find(p => p.id === providerId);
    if (!provider) return;

    const current = requests.find(r => r.id === requestId);
    if (!current) return;

    const currentQuote = current.quote || {
      serviceFee: { amount: current.confirmedPrice, isPending: current.confirmedPrice === undefined },
      suppliesFee: { amount: suppliesFee || 0, isPending: false },
      labThirdPartyFee: { amount: labFee || 0, isPending: false },
      transportationFee: { amount: travelFee !== undefined ? travelFee : current.travelFee, isPending: false },
      customerAcceptanceStatus: 'pending',
      isTotalPending: false,
    };

    const updatedQuote = {
      ...currentQuote,
      suppliesFee: suppliesFee !== undefined ? { amount: suppliesFee, isPending: false } : currentQuote.suppliesFee,
      labThirdPartyFee: labFee !== undefined ? { amount: labFee, isPending: false } : currentQuote.labThirdPartyFee,
      transportationFee: travelFee !== undefined ? { amount: travelFee, isPending: false } : currentQuote.transportationFee,
    };

    const updatedReq: CustomerRequest = {
      ...current,
      assignedProviderId: provider.id,
      assignedProviderName: provider.name,
      providerCost: provider.agreedRate,
      travelFee: travelFee !== undefined ? travelFee : current.travelFee,
      quote: updatedQuote,
      updatedAt: new Date().toISOString(),
      statusHistory: [
        ...(current.statusHistory || []),
        {
          status: current.status,
          timestamp: new Date().toISOString(),
          changedBy: 'منسق الرعاية (Coordinator)',
          note: `تعيين مقدم الرعاية: ${provider.name} وتحديث التكاليف المنفصلة`,
        },
      ],
    };

    if (isFirebaseConfigured && db && auth?.currentUser) {
      try {
        await setDoc(doc(db, 'customerRequests', requestId), removeUndefinedFields(updatedReq), { merge: true });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `customerRequests/${requestId}`);
      }
    }

    setRequests(prev => prev.map(r => (r.id === requestId ? updatedReq : r)));

    await recordAuditLog(
      'assign_provider',
      'customerRequests',
      requestId,
      `Assigned provider ${provider.name} (Cost: ${provider.agreedRate} EGP)`
    );
  };

  return (
    <DataContext.Provider
      value={{
        settings,
        content,
        categories,
        services,
        areas,
        requests,
        reviews,
        providers,
        integrations,
        isLoading,
        isError,
        errorMessage,
        migrationSummary,
        runMigration,
        retryConnection,
        resetToDefaults,
        addProvider,
        updateProvider,
        deleteProvider,
        matchProviders,
        updateIntegration,
        approveServicePrice,
        publishService,
        rejectServicePrice,
        assignRequestProvider,
        updateSettings,
        updateContent,
        addCategory,
        updateCategory,
        deleteCategory,
        addService,
        updateService,
        approveAndPublishService,
        toggleServiceActive,
        deleteService,
        addArea,
        updateArea,
        deleteArea,
        createCustomerRequest,
        retryWhatsAppNotification,
        retryTelegramNotification,
        updateRequestStatus,
        updateRequestNearestProvidersToggle,
        updateRequestConfirmedPrice,
        updateRequestAdminNotes,
        updateRequestQuote,
        deleteCustomerRequest,
        addReview,
        updateReview,
        deleteReview,
        recordAuditLog,
      }}
    >
      {children}
    </DataContext.Provider>
  );
};

export const useData = (): DataContextType => {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};
