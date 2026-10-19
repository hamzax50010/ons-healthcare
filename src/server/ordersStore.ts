import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isValidStatusTransition } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ORDERS_FILE = path.resolve(__dirname, '../../orders-store.json');

export interface ServerOrder {
  id: string;
  serviceId?: string;
  serviceNameAr?: string;
  serviceNameEn?: string;
  areaId?: string;
  areaNameAr?: string;
  areaNameEn?: string;
  customerName: string;
  phone: string;
  whatsapp?: string;
  addressDetails?: string;
  preferredDate?: string;
  preferredTimeSlot?: string;
  notes?: string;
  status: string;
  assignedProviderId?: string;
  assignedProviderName?: string;
  totalAmount?: number;
  agreedPrice?: number;
  providerCost?: number;
  identityDocumentUrl?: string;
  identityDocumentName?: string;
  internalNotes?: string[];
  statusHistory?: Array<{
    status: string;
    timestamp: string;
    changedBy: string;
    note?: string;
  }>;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

export interface ProviderInfo {
  id: string;
  name: string;
  phone?: string;
  role?: string;
  agreedRate?: number;
  specializations?: string[];
}

const DEFAULT_PROVIDERS: ProviderInfo[] = [
  {
    id: 'prov-001',
    name: 'د. أحمد محمود (تمريض عام وقسطرة)',
    phone: '+201012345678',
    role: 'nurse',
    agreedRate: 250,
    specializations: ['قسطرة بولية', 'تركيب كانيولا', 'مغذي وريدي'],
  },
  {
    id: 'prov-002',
    name: 'أ. سارة حسين (رعاية لكبار السن وزيارات منزلية)',
    phone: '+201098765432',
    role: 'elderly_care',
    agreedRate: 300,
    specializations: ['رعاية مسنين', 'تغيير جروح معقدة'],
  },
  {
    id: 'prov-003',
    name: 'د. محمد القاضي (علاج طبيعي وتأهيل)',
    phone: '+201122334455',
    role: 'physiotherapist',
    agreedRate: 400,
    specializations: ['علاج طبيعي', 'تأهيل حركي'],
  },
];

export function loadStoredOrders(): ServerOrder[] {
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      const raw = fs.readFileSync(ORDERS_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[OrdersStore] Could not read orders-store.json:', err);
  }
  return [];
}

export function saveStoredOrders(orders: ServerOrder[]): void {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf-8');
  } catch (err) {
    console.error('[OrdersStore] Could not write orders-store.json:', err);
  }
}

export function upsertServerOrder(order: ServerOrder): ServerOrder {
  const orders = loadStoredOrders();
  const index = orders.findIndex((o) => o.id === order.id);
  const now = new Date().toISOString();

  const formattedOrder: ServerOrder = {
    ...order,
    status: order.status || 'new',
    updatedAt: now,
    createdAt: order.createdAt || now,
    internalNotes: order.internalNotes || [],
    statusHistory: order.statusHistory || [
      {
        status: order.status || 'new',
        timestamp: now,
        changedBy: 'System',
        note: 'طلب جديد مسجل في النظام',
      },
    ],
  };

  if (index >= 0) {
    orders[index] = { ...orders[index], ...formattedOrder };
  } else {
    orders.unshift(formattedOrder);
  }

  saveStoredOrders(orders);
  return formattedOrder;
}

export function getOrderById(id: string): ServerOrder | undefined {
  const orders = loadStoredOrders();
  return orders.find((o) => o.id === id);
}

export function updateOrderStatusOnServer(
  orderId: string,
  status: string,
  changedBy: string = 'System',
  note?: string
): ServerOrder | undefined {
  const orders = loadStoredOrders();
  const order = orders.find((o) => o.id === orderId);

  if (!order) return undefined;

  // Enforce strict unidirectional status transition rules
  if (!isValidStatusTransition(order.status, status)) {
    throw new Error(`انتقال غير مسموح به من الحالة الحالي «${order.status}» إلى «${status}». لا يمكن التراجع عن الحالات المتقدمة أو تعديل الحالات النهائية.`);
  }

  const now = new Date().toISOString();
  order.status = status;
  order.updatedAt = now;

  if (!order.statusHistory) {
    order.statusHistory = [];
  }

  order.statusHistory.push({
    status,
    timestamp: now,
    changedBy,
    note: note || `تم تغيير الحالة إلى ${status}`,
  });

  saveStoredOrders(orders);
  return order;
}

export function assignProviderOnServer(
  orderId: string,
  providerId: string,
  adminLabel: string = 'المشرف'
): { success: boolean; order?: ServerOrder; provider?: ProviderInfo; error?: string } {
  const orders = loadStoredOrders();
  const order = orders.find((o) => o.id === orderId);
  const provider = DEFAULT_PROVIDERS.find((p) => p.id === providerId);

  if (!order) {
    return { success: false, error: 'الطلب غير موجود' };
  }

  if (!provider) {
    return { success: false, error: 'الممارس الطبي غير موجود' };
  }

  const now = new Date().toISOString();
  order.assignedProviderId = provider.id;
  order.assignedProviderName = provider.name;
  if (provider.agreedRate) {
    order.providerCost = provider.agreedRate;
  }
  order.updatedAt = now;

  if (!order.statusHistory) {
    order.statusHistory = [];
  }

  order.statusHistory.push({
    status: order.status,
    timestamp: now,
    changedBy: adminLabel,
    note: `تم تعيين الممارس: ${provider.name}`,
  });

  saveStoredOrders(orders);
  return { success: true, order, provider };
}

export function updatePriceOnServer(
  orderId: string,
  price: number,
  currency: string = 'ج.م',
  adminLabel: string = 'المشرف'
): ServerOrder | undefined {
  const orders = loadStoredOrders();
  const order = orders.find((o) => o.id === orderId);

  if (!order) return undefined;

  const now = new Date().toISOString();
  order.agreedPrice = price;
  order.totalAmount = price;
  order.updatedAt = now;

  if (!order.statusHistory) {
    order.statusHistory = [];
  }

  order.statusHistory.push({
    status: order.status,
    timestamp: now,
    changedBy: adminLabel,
    note: `تم اعتماد السعر الإجمالي: ${price} ${currency}`,
  });

  saveStoredOrders(orders);
  return order;
}

export function addAdminNoteOnServer(
  orderId: string,
  note: string,
  adminLabel: string = 'المشرف'
): ServerOrder | undefined {
  const orders = loadStoredOrders();
  const order = orders.find((o) => o.id === orderId);

  if (!order) return undefined;

  const now = new Date().toISOString();
  if (!order.internalNotes) {
    order.internalNotes = [];
  }

  order.internalNotes.push(`[${now.slice(0, 16)} - ${adminLabel}]: ${note}`);
  order.updatedAt = now;

  saveStoredOrders(orders);
  return order;
}

export function updateTravelFeePaymentStatusOnServer(
  orderId: string,
  status: string = 'تم دفع رسوم الانتقال',
  adminLabel: string = 'المشرف'
): ServerOrder | undefined {
  const orders = loadStoredOrders();
  const order = orders.find((o) => o.id === orderId);

  if (!order) return undefined;

  const now = new Date().toISOString();
  order.transportationPaymentStatus = status;
  order.travelFeePaid = true;
  order.updatedAt = now;

  if (!order.statusHistory) {
    order.statusHistory = [];
  }

  order.statusHistory.push({
    status: order.status,
    timestamp: now,
    changedBy: adminLabel,
    note: `تأكيد دفع رسوم الانتقال بواسطة المشرف (${adminLabel})`,
  });

  saveStoredOrders(orders);
  return order;
}

export function deleteOrderOnServer(
  orderId: string,
  adminLabel: string = 'المشرف'
): { success: boolean; order?: ServerOrder; error?: string } {
  const orders = loadStoredOrders();
  const order = orders.find((o) => o.id === orderId);

  if (!order) {
    return { success: false, error: 'الطلب غير موجود' };
  }

  const now = new Date().toISOString();
  order.status = 'deleted';
  order.isDeleted = true;
  order.updatedAt = now;

  if (!order.statusHistory) {
    order.statusHistory = [];
  }

  order.statusHistory.push({
    status: 'deleted',
    timestamp: now,
    changedBy: adminLabel,
    note: `تم حذف الطلب نهائياً بواسطة المشرف (${adminLabel})`,
  });

  saveStoredOrders(orders);
  return { success: true, order };
}

export function getAvailableProviders(): ProviderInfo[] {
  return DEFAULT_PROVIDERS;
}
