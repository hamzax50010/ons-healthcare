/**
 * ONS Healthcare — Firestore Server-Side Sync Service
 * 
 * Directly connects Node.js express / Telegram server handlers
 * to the production Firestore database (customerRequests collection).
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, updateDoc, runTransaction } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { isValidStatusTransition, RequestStatus } from '../types/index.js';
import { upsertServerOrder, getOrderById, ServerOrder } from './ordersStore.js';

let dbInstance: any = null;

function getFirestoreDb() {
  if (dbInstance) return dbInstance;

  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) {
      console.warn('[Firestore Server] firebase-applet-config.json not found');
      return null;
    }

    const configRaw = fs.readFileSync(configPath, 'utf-8');
    const firebaseConfig = JSON.parse(configRaw);

    const app = getApps().length > 0 ? getApp() : initializeApp({
      apiKey: firebaseConfig.apiKey,
      authDomain: firebaseConfig.authDomain,
      projectId: firebaseConfig.projectId,
      storageBucket: firebaseConfig.storageBucket,
      messagingSenderId: firebaseConfig.messagingSenderId,
      appId: firebaseConfig.appId,
    });

    // Explicitly connect to the DEFAULT database ID ('(default)')
    dbInstance = getFirestore(app);
    console.log(`[Firestore Server Init] Connected to Project ID: "${firebaseConfig.projectId}" | Database ID: "(default)"`);
    return dbInstance;
  } catch (err) {
    console.error('[Firestore Server] Failed to initialize Firestore SDK:', err);
    return null;
  }
}

/**
 * Fetches order from Firestore customerRequests collection.
 * Falls back to local ordersStore if Firestore document is not found or fails.
 */
export async function getOrderFromFirestore(orderId: string): Promise<any | null> {
  const db = getFirestoreDb();
  if (db) {
    try {
      const docRef = doc(db, 'customerRequests', orderId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        const orderData = { id: snap.id, ...data };
        upsertServerOrder(orderData as any);
        return orderData;
      }
    } catch (err) {
      console.warn(`[Firestore Server] Could not fetch order ${orderId} from Firestore:`, err);
    }
  }

  return getOrderById(orderId) || null;
}

/**
 * Updates order status in Firestore and syncs with ordersStore.
 * Enforces isValidStatusTransition.
 */
export async function updateOrderStatusInFirestore(
  orderId: string,
  targetStatus: RequestStatus | string,
  changedBy: string = 'بوت تيليجرام (المشرف)',
  transitionNote?: string
): Promise<{ success: boolean; order?: any; error?: string }> {
  const currentOrder = await getOrderFromFirestore(orderId);
  if (!currentOrder) {
    return { success: false, error: 'الطلب غير موجود في قاعدة البيانات.' };
  }

  const currentStatus = currentOrder.status || 'new';

  if (!isValidStatusTransition(currentStatus, targetStatus)) {
    return {
      success: false,
      error: `لا يمكن تحويل حالة الطلب من «${currentStatus}» إلى «${targetStatus}». الحالات النهائية أو المتقدمة غير قابلة للتراجع.`,
    };
  }

  const now = new Date().toISOString();
  const statusHistoryEntry = {
    status: targetStatus,
    timestamp: now,
    changedBy,
    note: transitionNote || `تحديث الحالة عبر بوت تيليجرام إلى: ${targetStatus}`,
  };

  const updatedHistory = [...(currentOrder.statusHistory || []), statusHistoryEntry];

  const payloadToUpdate: any = {
    status: targetStatus,
    updatedAt: now,
    statusHistory: updatedHistory,
  };

  const db = getFirestoreDb();
  if (db) {
    try {
      const docRef = doc(db, 'customerRequests', orderId);
      await updateDoc(docRef, payloadToUpdate);
    } catch (err: any) {
      console.error(`[Firestore Server] Update failed for ${orderId}:`, err);
      return { success: false, error: err.message || 'فشل تحديث المستند في قاعدة بيانات Firestore.' };
    }
  }

  const updatedOrder = {
    ...currentOrder,
    status: targetStatus,
    updatedAt: now,
    statusHistory: updatedHistory,
  };

  upsertServerOrder(updatedOrder as ServerOrder);

  return { success: true, order: updatedOrder };
}

/**
 * Updates confirmed price atomically in Firestore customerRequests collection using runTransaction.
 * Enforces immutability: confirmedPrice can only be set ONCE. Rejects any secondary attempts.
 */
export async function updateOrderConfirmedPriceInFirestore(
  orderId: string,
  confirmedPrice: number,
  changedBy: string = 'بوت تيليجرام (المشرف)'
): Promise<{ success: boolean; order?: any; error?: string }> {
  if (typeof confirmedPrice !== 'number' || isNaN(confirmedPrice) || confirmedPrice <= 0) {
    return { success: false, error: 'السعر المعتمد النهائي يجب أن يكون رقماً موجباً غير صفر.' };
  }

  const db = getFirestoreDb();
  let updatedOrder: any = null;
  let transactionError: string | null = null;

  if (db) {
    try {
      const docRef = doc(db, 'customerRequests', orderId);

      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(docRef);
        if (!snap.exists()) {
          throw new Error('الطلب غير موجود في قاعدة البيانات.');
        }

        const data = snap.data();
        if (data.confirmedPrice !== undefined && data.confirmedPrice !== null) {
          throw new Error(`تم اعتماد السعر المعتمد النهائي مسبقاً (${data.confirmedPrice} ج.م) ومحمي من إعادة التعديل.`);
        }

        const now = new Date().toISOString();
        const historyEntry = {
          status: data.status,
          timestamp: now,
          changedBy,
          note: `اعتماد السعر المعتمد النهائي عبر بوت تيليجرام: ${confirmedPrice} ج.م`,
        };

        const updatedHistory = [...(data.statusHistory || []), historyEntry];

        transaction.update(docRef, {
          confirmedPrice,
          updatedAt: now,
          statusHistory: updatedHistory,
        });

        updatedOrder = {
          id: snap.id,
          ...data,
          confirmedPrice,
          updatedAt: now,
          statusHistory: updatedHistory,
        };
      });
    } catch (err: any) {
      if (err.message && err.message.includes('مسبقاً')) {
        return { success: false, error: err.message };
      }
      console.warn(`[Firestore Server Transaction Notice] ${err.message || err}`);
      transactionError = err.message || 'فشل اعتماد السعر في قاعدة البيانات.';
    }
  }

  // Fallback / sync to ordersStore for local testing
  if (!updatedOrder) {
    const currentOrder = getOrderById(orderId);
    if (!currentOrder) {
      return { success: false, error: transactionError || 'الطلب غير موجود في قاعدة البيانات.' };
    }
    if (currentOrder.confirmedPrice !== undefined && currentOrder.confirmedPrice !== null) {
      return {
        success: false,
        error: `تم اعتماد السعر المعتمد النهائي مسبقاً (${currentOrder.confirmedPrice} ج.م) ومحمي من إعادة التعديل.`,
      };
    }
    const now = new Date().toISOString();
    const historyEntry = {
      status: currentOrder.status,
      timestamp: now,
      changedBy,
      note: `اعتماد السعر المعتمد النهائي عبر بوت تيليجرام: ${confirmedPrice} ج.م`,
    };
    const updatedHistory = [...(currentOrder.statusHistory || []), historyEntry];
    updatedOrder = {
      ...currentOrder,
      confirmedPrice,
      updatedAt: now,
      statusHistory: updatedHistory,
    };
  }

  if (updatedOrder) {
    upsertServerOrder(updatedOrder as ServerOrder);
  }

  return { success: true, order: updatedOrder };
}
