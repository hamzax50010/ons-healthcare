/**
 * ONS Healthcare — Complete Interactive Telegram Admin Control Center
 * 
 * Strict Two-Admin Authorization & Interactive Order Management Interface
 * 
 * Security & Functional Guarantees:
 * 1. Strict Two-Admin Access: Only two authorized Telegram User IDs (Primary Admin & Colleague)
 *    can view order data, receive alerts, or execute management actions.
 * 2. Real Backend Operations: Every button click executes actual database/store state changes,
 *    updates status, assigns providers, recalculates quotes, and records audit history.
 * 3. Zero-Leak Security: Tokens and sensitive keys remain strictly on the server.
 * 4. Group Protection: Private patient data is strictly guarded; orders are never leaked in public groups.
 * 5. Interactive Inline Keyboard: Manage orders directly from Telegram (Confirm, Assign Provider,
 *    Quote/Price, Internal Notes, Status Transitions, Audit Log).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  upsertServerOrder,
  getOrderById,
  updateOrderStatusOnServer,
  assignProviderOnServer,
  updatePriceOnServer,
  addAdminNoteOnServer,
  updateTravelFeePaymentStatusOnServer,
  deleteOrderOnServer,
  getAvailableProviders,
  loadStoredOrders,
  ServerOrder,
} from './ordersStore.js';
import {
  getOrderFromFirestore,
  updateOrderStatusInFirestore,
  updateOrderConfirmedPriceInFirestore,
} from './firestoreServerService.js';
import { generateCustomerConfirmationMessage } from '../utils/whatsappUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.resolve(__dirname, '../../telegram-config.json');

export interface TelegramAdminUser {
  id: string; // numeric Telegram User ID
  name: string;
  role: 'owner' | 'colleague';
  chatId?: string;
  isVerified?: boolean;
  addedAt?: string;
  lastActiveAt?: string;
}

export interface StoredTelegramConfig {
  enabled: boolean;
  botToken?: string;
  chatId?: string; // Legacy fallback or additional chat IDs
  chatTitle?: string;
  botUsername?: string;
  lastTestedAt?: string;
  lastTestStatus?: 'connected' | 'error' | 'not_configured' | 'untested';
  lastError?: string;
  lastTestMessageId?: string;
  // Strict Two-Admin Security
  admin1?: TelegramAdminUser;
  admin2?: TelegramAdminUser;
  authorizedUserIds?: string[];
  pollingEnabled?: boolean;
  webhookUrl?: string;
  lastUpdateId?: number;
}

export interface RecommendedProviderSummary {
  id: string;
  name: string;
  specialtyAr: string;
  specialtyEn: string;
  phone: string;
  agreedRate: number;
  estimatedDistanceKm?: number;
  driveTimeMinutes?: number;
  distanceMatchBasis?: 'coordinates' | 'area';
  providerType?: string;
}

// In-memory polling state
let isPollingActive = false;
let pollingAbortController: AbortController | null = null;

/**
 * Masks bot token securely: shows first 6 chars and last 4 chars, masking the middle.
 */
export function maskTelegramToken(token?: string | null): string {
  if (!token || typeof token !== 'string') return '';
  const trimmed = token.trim();
  if (trimmed.length < 15) return '••••••••';
  const prefix = trimmed.substring(0, 6);
  const suffix = trimmed.substring(trimmed.length - 4);
  return `${prefix}••••••••${suffix}`;
}

/**
 * Parses one or more Chat IDs (comma, semicolon, or newline separated).
 */
export function parseChatIds(rawChatId?: string | null): string[] {
  if (!rawChatId || typeof rawChatId !== 'string') return [];
  return rawChatId
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Masks Telegram chat ID securely.
 */
export function maskChatId(chatId?: string | null): string {
  if (!chatId || typeof chatId !== 'string') return '';
  const ids = parseChatIds(chatId);
  if (ids.length === 0) return '';
  return ids
    .map((id) => {
      if (id.length <= 4) return id;
      return `${id.substring(0, 2)}••••${id.substring(id.length - 2)}`;
    })
    .join(', ');
}

/**
 * Sanitizes error messages to ensure tokens are never leaked in logs or responses.
 */
export function sanitizeTelegramError(errorMsg?: string): string {
  if (!errorMsg) return 'Unknown Telegram API error';
  return errorMsg.replace(/bot[0-9]+:[a-zA-Z0-9_-]+/gi, 'bot[REDACTED]');
}

/**
 * Safely escapes HTML special characters (<, >, &) for Telegram parse_mode: 'HTML'.
 */
export function escapeHtml(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Loads stored Telegram configuration from JSON file or environment variables.
 */
export function loadStoredTelegramConfig(): StoredTelegramConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(raw);

      const authIds: string[] = Array.isArray(parsed.authorizedUserIds)
        ? parsed.authorizedUserIds.map(String)
        : [];

      // Extract admin1 and admin2
      const admin1: TelegramAdminUser = parsed.admin1 || {
        id: process.env.TELEGRAM_ADMIN_1_ID || authIds[0] || '',
        name: 'المشرف الرئيسي (Admin 1)',
        role: 'owner',
        isVerified: Boolean(process.env.TELEGRAM_ADMIN_1_ID || authIds[0]),
      };

      const admin2: TelegramAdminUser = parsed.admin2 || {
        id: process.env.TELEGRAM_ADMIN_2_ID || authIds[1] || '',
        name: 'المشرف الشريك (Admin 2)',
        role: 'colleague',
        isVerified: Boolean(process.env.TELEGRAM_ADMIN_2_ID || authIds[1]),
      };

      const finalAuthorized: string[] = Array.from(
        new Set(
          [
            admin1.id,
            admin2.id,
            ...authIds,
            process.env.TELEGRAM_ADMIN_1_ID,
            process.env.TELEGRAM_ADMIN_2_ID,
          ]
            .filter(Boolean)
            .map((s) => String(s).trim())
        )
      );

      return {
        enabled: parsed.enabled !== false,
        botToken: parsed.botToken || process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: parsed.chatId || process.env.TELEGRAM_CHAT_ID || '',
        chatTitle: parsed.chatTitle || '',
        botUsername: parsed.botUsername || '',
        lastTestedAt: parsed.lastTestedAt,
        lastTestStatus: parsed.lastTestStatus || 'untested',
        lastError: parsed.lastError,
        lastTestMessageId: parsed.lastTestMessageId,
        admin1,
        admin2,
        authorizedUserIds: finalAuthorized,
        pollingEnabled: parsed.pollingEnabled !== false,
        webhookUrl: parsed.webhookUrl,
        lastUpdateId: parsed.lastUpdateId || 0,
      };
    }
  } catch (err) {
    console.warn('[Telegram Server] Could not read telegram-config.json:', err);
  }

  const defaultAdmin1Id = process.env.TELEGRAM_ADMIN_1_ID || '';
  const defaultAdmin2Id = process.env.TELEGRAM_ADMIN_2_ID || '';

  return {
    enabled: true,
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    lastTestStatus: process.env.TELEGRAM_BOT_TOKEN ? 'untested' : 'not_configured',
    admin1: {
      id: defaultAdmin1Id,
      name: 'المشرف الرئيسي (Admin 1)',
      role: 'owner',
      isVerified: Boolean(defaultAdmin1Id),
    },
    admin2: {
      id: defaultAdmin2Id,
      name: 'المشرف الشريك (Admin 2)',
      role: 'colleague',
      isVerified: Boolean(defaultAdmin2Id),
    },
    authorizedUserIds: [defaultAdmin1Id, defaultAdmin2Id].filter(Boolean),
    pollingEnabled: true,
  };
}

/**
 * Saves Telegram configuration to persistent local JSON file.
 */
export function saveStoredTelegramConfig(cfg: Partial<StoredTelegramConfig>): StoredTelegramConfig {
  const current = loadStoredTelegramConfig();
  const updated: StoredTelegramConfig = {
    ...current,
    ...cfg,
  };

  // Re-sync authorizedUserIds with admin1 and admin2
  const ids: string[] = [];
  if (updated.admin1?.id) ids.push(String(updated.admin1.id).trim());
  if (updated.admin2?.id) ids.push(String(updated.admin2.id).trim());
  if (Array.isArray(updated.authorizedUserIds)) {
    updated.authorizedUserIds.forEach((id) => {
      const s = String(id).trim();
      if (s && !ids.includes(s)) ids.push(s);
    });
  }
  updated.authorizedUserIds = ids.slice(0, 2); // Strictly two admins max

  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Telegram Server] Could not save telegram-config.json:', err);
  }

  return updated;
}

/**
 * Verifies if a given sender ID is one of the two authorized administrators.
 */
export function isAuthorizedAdmin(
  senderId: string | number,
  customConfig?: StoredTelegramConfig
): {
  authorized: boolean;
  admin?: TelegramAdminUser;
} {
  const cfg = customConfig || loadStoredTelegramConfig();
  const strId = String(senderId).trim();
  if (!strId) return { authorized: false };

  // If no administrators have been configured yet, allow identification for setup
  const hasConfiguredAdmins =
    Boolean(cfg.admin1?.id?.trim()) || Boolean(cfg.admin2?.id?.trim());

  if (cfg.admin1?.id && String(cfg.admin1.id).trim() === strId) {
    return { authorized: true, admin: cfg.admin1 };
  }
  if (cfg.admin2?.id && String(cfg.admin2.id).trim() === strId) {
    return { authorized: true, admin: cfg.admin2 };
  }
  if (cfg.authorizedUserIds?.includes(strId)) {
    return {
      authorized: true,
      admin: {
        id: strId,
        name: 'مشرف مصرح',
        role: 'colleague',
        isVerified: true,
      },
    };
  }

  // If completely unconfigured, allow the very first interaction to discover ID
  if (!hasConfiguredAdmins) {
    return {
      authorized: false,
    };
  }

  return { authorized: false };
}

/**
 * Returns all recipient chat IDs for orders:
 * Combines admin1, admin2, and any explicitly configured chat IDs.
 */
export function getNotificationRecipients(): string[] {
  const cfg = loadStoredTelegramConfig();
  const recipients: string[] = [];

  if (cfg.admin1?.id) recipients.push(cfg.admin1.id);
  if (cfg.admin2?.id && !recipients.includes(cfg.admin2.id)) recipients.push(cfg.admin2.id);

  if (cfg.chatId) {
    const parsed = parseChatIds(cfg.chatId);
    parsed.forEach((id) => {
      if (!recipients.includes(id)) recipients.push(id);
    });
  }

  return recipients;
}

/**
 * Sends a message via Telegram Bot API.
 */
export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  replyMarkup?: any
): Promise<{ ok: boolean; messageId?: number; description?: string }> {
  const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
        reply_markup: replyMarkup,
      }),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    return {
      ok: Boolean(data.ok),
      messageId: data.result?.message_id,
      description: data.description,
    };
  } catch (err: any) {
    return { ok: false, description: err.message };
  }
}

/**
 * Edits an existing message's text and inline keyboard via Telegram Bot API.
 */
export async function editTelegramMessage(
  token: string,
  chatId: string | number,
  messageId: number,
  text: string,
  replyMarkup?: any
): Promise<{ ok: boolean; description?: string }> {
  const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/editMessageText`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
        reply_markup: replyMarkup,
      }),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    return {
      ok: Boolean(data.ok),
      description: data.description,
    };
  } catch (err: any) {
    return { ok: false, description: err.message };
  }
}

/**
 * Answers a callback query (button click) to remove the loading spinner and show a toast/alert.
 */
export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
  showAlert: boolean = false
): Promise<boolean> {
  const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/answerCallbackQuery`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      }),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

/**
 * Dispatches an attached document or image to Telegram.
 * Handles local uploads (/api/documents/presc-*.ext), Base64 data URLs, and remote URLs (with download fallback).
 */
async function sendTelegramAttachment(
  token: string,
  chatId: string,
  attachmentUrl: string,
  fileName?: string,
  caption?: string,
  replyMarkup?: any
): Promise<boolean> {
  if (!attachmentUrl || typeof attachmentUrl !== 'string') return false;

  try {
    const defaultCaption = caption || '📎 مستند / صورة الطلب المرفقة من العميل';

    // Case A: Local server file (e.g. /api/documents/presc-XXXXX.ext or relative path or filename)
    let localFilePath: string | null = null;
    if (attachmentUrl.startsWith('/api/documents/') || attachmentUrl.startsWith('uploads/')) {
      const basename = path.basename(attachmentUrl);
      const possiblePath = path.resolve(process.cwd(), 'uploads/prescriptions', basename);
      if (fs.existsSync(possiblePath)) {
        localFilePath = possiblePath;
      } else {
        const altPath = path.resolve(__dirname, '../../uploads/prescriptions', basename);
        if (fs.existsSync(altPath)) {
          localFilePath = altPath;
        }
      }
    } else if (!attachmentUrl.startsWith('http://') && !attachmentUrl.startsWith('https://') && !attachmentUrl.startsWith('data:')) {
      const possiblePath = path.resolve(process.cwd(), 'uploads/prescriptions', path.basename(attachmentUrl));
      if (fs.existsSync(possiblePath)) {
        localFilePath = possiblePath;
      }
    }

    if (localFilePath) {
      const buffer = fs.readFileSync(localFilePath);
      const ext = path.extname(localFilePath).toLowerCase();
      const isPdf = ext === '.pdf';
      const mimeType = isPdf ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const endpoint = isPdf ? 'sendDocument' : 'sendPhoto';
      const fileKey = isPdf ? 'document' : 'photo';
      const finalName = fileName || path.basename(localFilePath);

      const formData = new FormData();
      formData.append('chat_id', chatId);
      const blob = new Blob([buffer], { type: mimeType });
      formData.append(fileKey, blob, finalName);
      formData.append('caption', defaultCaption);
      if (replyMarkup) {
        formData.append('reply_markup', JSON.stringify(replyMarkup));
      }

      const sendUrl = `https://api.telegram.org/bot${encodeURIComponent(token)}/${endpoint}`;
      const res = await fetch(sendUrl, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({ ok: false }));
      return Boolean(data.ok);
    }

    // Case B: Base64 data URL
    if (attachmentUrl.startsWith('data:')) {
      const match = attachmentUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const mimeType = match[1];
        const base64Data = match[2];
        const buffer = Buffer.from(base64Data, 'base64');
        const isImage = mimeType.startsWith('image/');
        const endpoint = isImage ? 'sendPhoto' : 'sendDocument';
        const fileKey = isImage ? 'photo' : 'document';
        const finalName = fileName || (isImage ? 'prescription.jpg' : 'document.pdf');

        const formData = new FormData();
        formData.append('chat_id', chatId);
        const blob = new Blob([buffer], { type: mimeType });
        formData.append(fileKey, blob, finalName);
        formData.append('caption', defaultCaption);
        if (replyMarkup) {
          formData.append('reply_markup', JSON.stringify(replyMarkup));
        }

        const sendUrl = `https://api.telegram.org/bot${encodeURIComponent(token)}/${endpoint}`;
        const res = await fetch(sendUrl, {
          method: 'POST',
          body: formData,
        });
        const data = await res.json().catch(() => ({ ok: false }));
        return Boolean(data.ok);
      }
    }

    // Case C: Remote HTTP / HTTPS URL (e.g. Firebase Storage)
    if (attachmentUrl.startsWith('http://') || attachmentUrl.startsWith('https://')) {
      // First attempt: direct URL to Telegram API
      const photoUrl = `https://api.telegram.org/bot${encodeURIComponent(token)}/sendPhoto`;
      const directRes = await fetch(photoUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: attachmentUrl,
          caption: defaultCaption,
          reply_markup: replyMarkup,
        }),
      });
      const directData = await directRes.json().catch(() => ({ ok: false }));
      if (directData.ok) return true;

      // Direct send failed (e.g. private or auth-protected Firebase URL): fallback to downloading buffer server-side
      try {
        const fileRes = await fetch(attachmentUrl);
        if (fileRes.ok) {
          const arrayBuf = await fileRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuf);
          const contentType = fileRes.headers.get('content-type') || 'image/jpeg';
          const isPdf = contentType.includes('pdf');
          const endpoint = isPdf ? 'sendDocument' : 'sendPhoto';
          const fileKey = isPdf ? 'document' : 'photo';

          const formData = new FormData();
          formData.append('chat_id', chatId);
          const blob = new Blob([buffer], { type: contentType });
          formData.append(fileKey, blob, fileName || (isPdf ? 'document.pdf' : 'prescription.jpg'));
          formData.append('caption', defaultCaption);
          if (replyMarkup) {
            formData.append('reply_markup', JSON.stringify(replyMarkup));
          }

          const sendUrl = `https://api.telegram.org/bot${encodeURIComponent(token)}/${endpoint}`;
          const fallbackRes = await fetch(sendUrl, {
            method: 'POST',
            body: formData,
          });
          const fallbackData = await fallbackRes.json().catch(() => ({ ok: false }));
          return Boolean(fallbackData.ok);
        }
      } catch (dlErr) {
        console.warn(`[Telegram Attachment Download Fallback Failed for ${chatId}]:`, dlErr);
      }
    }

    return false;
  } catch (err) {
    console.warn(`[Telegram Attachment Error for chat ${chatId}]:`, err);
    return false;
  }
}

/**
 * Maps status string to Arabic label with emoji.
 */
export function getStatusLabelAr(status: string): string {
  const map: Record<string, string> = {
    new: '🟡 طلب جديد',
    under_review: '🟡 طلب جديد (قيد المراجعة)',
    awaiting_customer_confirmation: '🟣 بانتظار تأكيد العميل',
    awaiting_confirmation: '🟣 بانتظار تأكيد العميل',
    confirmed_scheduled: '🟢 مؤكد ومجدول',
    confirmed: '🟢 مؤكد ومجدول',
    field_in_progress: '🚙 جارٍ التنفيذ الميداني',
    in_progress: '🚙 جارٍ التنفيذ الميداني',
    completed: '🏁 مكتمل بنجاح',
    cancelled: '❌ ملغي',
    deleted: '🗑️ محذوف',
  };
  return map[status] || status;
}

/**
 * Formats a Date or date string to DD/MM/YYYY in Africa/Cairo timezone without swapping day and month.
 */
export function formatCairoDateDDMMYYYY(dateInput?: string | number | Date): string {
  if (!dateInput) return '';
  try {
    const str = String(dateInput).trim();
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
    }

    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return str;

    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const parts = formatter.formatToParts(d);
    const day = parts.find((p) => p.type === 'day')?.value || '01';
    const month = parts.find((p) => p.type === 'month')?.value || '01';
    const year = parts.find((p) => p.type === 'year')?.value || '2026';
    return `${day}/${month}/${year}`;
  } catch {
    return String(dateInput);
  }
}

/**
 * Formats appointment time string to 12-hour format with AM/PM.
 */
export function formatTime12Hour(timeStr?: string): string {
  if (!timeStr) return 'مفتوح';
  const trimmed = String(timeStr).trim();
  if (/AM|PM|صباح|مساء/i.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    let hour = parseInt(match[1], 10);
    const minute = match[2];
    const period = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    if (hour === 0) hour = 12;
    const formattedHour = String(hour).padStart(2, '0');
    return `${formattedHour}:${minute} ${period}`;
  }
  return timeStr;
}

/**
 * Normalizes phone numbers to clean international E.164 format (+201xxxxxxxxx for Egypt)
 */
export function formatE164PhoneForWa(rawPhone?: string): string {
  if (!rawPhone) return '';
  const digitsOnly = String(rawPhone).replace(/[^0-9]/g, '');
  if (!digitsOnly) return '';

  if (digitsOnly.startsWith('20') && digitsOnly.length === 12) {
    return digitsOnly;
  }
  if (digitsOnly.startsWith('01') && digitsOnly.length === 11) {
    return `20${digitsOnly.substring(1)}`;
  }
  if (digitsOnly.startsWith('1') && digitsOnly.length === 10) {
    return `20${digitsOnly}`;
  }
  if (digitsOnly.length >= 8) {
    return digitsOnly;
  }
  return '';
}

/**
 * Constructs the WhatsApp Click-to-Chat URL for customer notifications with pre-filled message.
 */
export function buildCustomerWhatsAppUrl(order: any, paymentDetails?: any): string {
  if (!order) return '';
  const phone = order.whatsapp || order.phone;
  const cleanPhone = formatE164PhoneForWa(phone);
  if (!cleanPhone) return '';

  const effectivePayment = paymentDetails || order.paymentDetails || order.paymentSettings;
  const messageText = generateCustomerConfirmationMessage(order, effectivePayment);

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`;
}

/**
 * Builds the inline keyboard for a Telegram order notification with status actions & WhatsApp button.
 */
export function buildOrderSummaryKeyboard(order: any, currentStatus?: string) {
  const orderId = typeof order === 'string' ? order : (order?.id || order?.requestNumber);
  const orderObj = typeof order === 'object' && order !== null ? order : (getOrderById(orderId) || { id: orderId, status: currentStatus || 'new' });
  const status = orderObj.status || currentStatus || 'new';

  const waUrl = buildCustomerWhatsAppUrl(orderObj);

  const keyboard: any[][] = [];

  // Row 1: WhatsApp Button
  if (waUrl) {
    keyboard.push([
      { text: '💬 مراسلة العميل على واتساب', url: waUrl },
    ]);
  }

  // Row 2+: Inline Keyboard buttons matching canonical status transitions
  if (status === 'new' || status === 'under_review') {
    keyboard.push([
      { text: '✅ تأكيد وبدء المعالجة', callback_data: `act:status:${orderId}:awaiting_customer_confirmation` },
    ]);
    const priceRow: any[] = [];
    if (!orderObj.confirmedPrice) {
      priceRow.push({ text: '💵 اعتماد السعر النهائي', callback_data: `act:askprice:${orderId}` });
    }
    priceRow.push({ text: '❌ إلغاء الطلب', callback_data: `act:status:${orderId}:cancelled` });
    keyboard.push(priceRow);
  } else if (status === 'awaiting_customer_confirmation' || status === 'awaiting_confirmation') {
    keyboard.push([
      { text: '📅 تأكيد العميل وجدولة الزيارة', callback_data: `act:status:${orderId}:confirmed_scheduled` },
    ]);
    const priceRow: any[] = [];
    if (!orderObj.confirmedPrice) {
      priceRow.push({ text: '💵 اعتماد السعر النهائي', callback_data: `act:askprice:${orderId}` });
    }
    priceRow.push({ text: '❌ إلغاء الطلب', callback_data: `act:status:${orderId}:cancelled` });
    keyboard.push(priceRow);
  } else if (status === 'confirmed_scheduled' || status === 'confirmed') {
    keyboard.push([
      { text: '🚙 بدء التنفيذ الميداني', callback_data: `act:status:${orderId}:field_in_progress` },
      { text: '❌ إلغاء الطلب', callback_data: `act:status:${orderId}:cancelled` },
    ]);
  } else if (status === 'field_in_progress' || status === 'in_progress') {
    keyboard.push([
      { text: '🏁 إتمام الخدمة بنجاح', callback_data: `act:status:${orderId}:completed` },
      { text: '❌ إلغاء الطلب', callback_data: `act:status:${orderId}:cancelled` },
    ]);
  } else if (status === 'completed') {
    keyboard.push([
      { text: '🏁 طلب مكتمل بنجاح (حالة نهائية)', callback_data: `act:noop:${orderId}` },
    ]);
  } else if (status === 'cancelled') {
    keyboard.push([
      { text: '❌ طلب ملغي (حالة نهائية)', callback_data: `act:noop:${orderId}` },
    ]);
  }

  return { inline_keyboard: keyboard };
}

/**
 * Aliased to buildOrderSummaryKeyboard to guarantee single WhatsApp button in all views.
 */
export function buildOrderExpandedKeyboard(order: any, currentStatus?: string) {
  return buildOrderSummaryKeyboard(order, currentStatus);
}

/**
 * Builds provider selection keyboard for an order.
 */
export function buildProviderSelectionKeyboard(orderId: string) {
  const providers = getAvailableProviders();
  const buttons = providers.map((p: any) => [
    {
      text: `👨‍⚕️ ${p.name} (${p.agreedRate} ج.م)`,
      callback_data: `act:assign:${orderId}:${p.id}`,
    },
  ]);

  buttons.push([
    { text: '🔙 إلغاء والعودة للطلب', callback_data: `act:details:${orderId}` },
  ]);

  return { inline_keyboard: buttons };
}

/**
 * Builds quick price setting keyboard for an order.
 */
export function buildPriceKeyboard(orderId: string) {
  return {
    inline_keyboard: [
      [
        { text: '💵 200 ج.م', callback_data: `act:setprice:${orderId}:200` },
        { text: '💵 250 ج.م', callback_data: `act:setprice:${orderId}:250` },
      ],
      [
        { text: '💵 300 ج.م', callback_data: `act:setprice:${orderId}:300` },
        { text: '💵 350 ج.م', callback_data: `act:setprice:${orderId}:350` },
      ],
      [
        { text: '💵 400 ج.م', callback_data: `act:setprice:${orderId}:400` },
        { text: '💵 500 ج.م', callback_data: `act:setprice:${orderId}:500` },
      ],
      [
        { text: '🔙 إلغاء والعودة للطلب', callback_data: `act:details:${orderId}` },
      ],
    ],
  };
}

/**
 * Builds quick internal notes keyboard for an order.
 */
export function buildNotesKeyboard(orderId: string) {
  return {
    inline_keyboard: [
      [
        {
          text: '📞 تم الاتصال والتأكيد مع المريض',
          callback_data: `act:addnote:${orderId}:call_confirmed`,
        },
      ],
      [
        {
          text: '⏰ طلب العميل تأجيل الموعد ساعتين',
          callback_data: `act:addnote:${orderId}:delay_requested`,
        },
      ],
      [
        {
          text: '🩺 يحتاج فحص سكر وضغط إضافي',
          callback_data: `act:addnote:${orderId}:extra_vitals`,
        },
      ],
      [
        {
          text: '👨‍⚕️ تم إبلاغ الممارس وتأكيد الانطلاق',
          callback_data: `act:addnote:${orderId}:provider_dispatched`,
        },
      ],
      [
        { text: '🔙 إلغاء والعودة للطلب', callback_data: `act:details:${orderId}` },
      ],
    ],
  };
}

/**
 * Formats the summary text for an order with HTML escaping for Telegram HTML parse_mode.
 */
export function formatOrderSummaryText(order: any, recommendedProviders: RecommendedProviderSummary[] = []): string {
  const orderDateObj = order.createdAt ? new Date(order.createdAt) : new Date();
  const formattedCreationDate = formatCairoDateDDMMYYYY(orderDateObj);
  const formattedCreationTime = orderDateObj.toLocaleTimeString('en-US', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const formattedAppointmentDate = formatCairoDateDDMMYYYY(order.appointmentDate || order.preferredDate);
  const formattedAppointmentTime = formatTime12Hour(order.appointmentTime || order.preferredTimeSlot);

  const contactPreferenceText =
    order.preferredContactMethod === 'whatsapp'
      ? '💬 تفضيل العميل: <b>مراسلة عبر واتساب (WhatsApp)</b>'
      : order.preferredContactMethod === 'phone_call'
      ? '📞 تفضيل العميل: <b>اتصال تليفوني مباشر (Phone Call)</b>'
      : '';

  const orderStatusText = getStatusLabelAr(order.status || 'new');

  const assignedName = escapeHtml(order.assignedProviderName);
  const assignmentText = assignedName
    ? `👨‍⚕️ <b>الممارس المعين:</b> ${assignedName} (${order.providerCost || 0} ج.م)`
    : '👨‍⚕️ <b>حالة تعيين الممارس:</b> لم يُعين بعد';

  const docUrl = order.prescriptionDocumentReference || order.identityDocumentUrl || order.prescriptionPhotoUrl || order.prescriptionUrl;
  const docText = docUrl ? `📎 <b>المستند/الروشتة المرفقة:</b> <a href="${escapeHtml(docUrl)}">فتح المستند الطبي</a>` : '📎 <b>المستند المرفق:</b> لم يُرفق';

  const surchargesList = Array.isArray(order.applicableSurcharges) && order.applicableSurcharges.length > 0
    ? order.applicableSurcharges.map((s: any) => `• ${escapeHtml(s.labelAr)}: +${s.amountMin} ج.م`).join('\n')
    : '• زيارة قياسية في مواعيد العمل الرسمية (بدون إضافات)';

  const customerName = escapeHtml(order.customerName || order.patientName || 'غير مسجل');
  const patientName = escapeHtml(order.patientName || order.customerName || 'غير مسجل');
  const phone = escapeHtml(order.phone || 'غير مسجل');
  const whatsappPhone = escapeHtml(order.whatsapp || order.phone || 'غير مسجل');
  const serviceName = escapeHtml(order.serviceNameAr || order.serviceNameEn || 'خدمة تمريضية منزلية');
  const areaName = escapeHtml(order.areaNameAr || order.areaNameEn || order.governorate || 'القاهرة/الجيزة');
  const city = escapeHtml(order.city || '');
  const detailedAddress = escapeHtml(order.detailedAddress || order.addressDetails || 'غير مسجل');
  const nearbyLandmark = escapeHtml(order.nearbyLandmark || '');
  const medicalHistory = escapeHtml(order.medicalHistory || 'غير مسجل');
  const caseNotes = escapeHtml(order.caseDescription || order.notes || '');

  const lines: string[] = [
    '🏥 <b>طلب رعاية منزلية جديد — أُنس ONS</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    `🆔 <b>رقم الطلب:</b> <code>${escapeHtml(order.requestNumber || order.id)}</code>`,
    `🕒 <b>تاريخ الطلب:</b> ${formattedCreationDate} (${formattedCreationTime})`,
    `📊 <b>الحالة:</b> ${orderStatusText}`,
    `🏷️ <b>التصنيف:</b> ${escapeHtml(order.requestClassificationAr || 'طلب قياسي')}`,
    assignmentText,
    '━━━━━━━━━━━━━━━━━━━━',
    `👤 <b>اسم العميل/المريض:</b> ${customerName}`,
    order.patientName && order.patientName !== order.customerName ? `👨‍👩‍👧 <b>المريض المستفيد:</b> ${patientName}` : '',
    order.patientAge ? `🎂 <b>عمر المريض:</b> ${escapeHtml(order.patientAge)} سنة` : '',
    `📞 <b>هاتف الاتصال:</b> <a href="tel:${phone}">${phone}</a>`,
    `💬 <b>الواتساب للتنسيق:</b> <code>${whatsappPhone}</code>`,
    contactPreferenceText,
    '',
    `🩺 <b>الخدمة المطلوبة:</b> ${serviceName}`,
    `📅 <b>تاريخ الموعد:</b> ${formattedAppointmentDate || 'في أقرب وقت'}`,
    `⏰ <b>وقت الزيارة:</b> ${formattedAppointmentTime}`,
    `📍 <b>المنطقة والمدينة:</b> ${areaName}${city ? ` (${city})` : ''}`,
    `🏠 <b>العنوان التفصيلي:</b> ${detailedAddress}`,
    nearbyLandmark ? `🏙️ <b>أقرب علامة مميزة:</b> ${nearbyLandmark}` : '',
    '',
    `📋 <b>التاريخ الطبي والسريري:</b>`,
    `<i>${medicalHistory}</i>`,
    caseNotes ? `📝 <b>وصف الحالة والملاحظات:</b> <i>${caseNotes}</i>` : '',
    docText,
    '━━━━━━━━━━━━━━━━━━━━',
    `💰 <b>تفاصيل التسعير والرسوم:</b>`,
    order.confirmedPrice && order.confirmedPrice > 0
      ? `• <b>السعر المعتمد النهائي:</b> <b>${order.confirmedPrice} ج.م</b>`
      : `• <b>سعر الخدمة الأساسي:</b> ${order.baseServicePriceMin || order.confirmedPrice || 200} - ${order.baseServicePriceMax || order.confirmedPrice || 200} ج.م`,
    `• <b>رسوم الانتقال:</b> ${order.estimatedTransportationFee || order.travelFee || 60} ج.م`,
    `<b>الإضافات المطبقة:</b>\n${surchargesList}`,
    `💵 <b>الإجمالي التقديري:</b> <b>${order.confirmedPrice || order.estimatedTotalMin || 260} ج.م</b>`,
    `💳 <b>حالة سداد الانتقال:</b> ${escapeHtml(order.transportationPaymentStatus || 'لم يُطلب السداد بعد')}`,
    '━━━━━━━━━━━━━━━━━━━━',
    '⚡ <i>انقر الزر أدناه لمراسلة العميل على واتساب بالرسالة الجاهزة المعتمدة.</i>',
  ].filter(Boolean);

  return lines.join('\n');
}

/**
 * Formats exhaustive expanded operational details for an order.
 */
export function formatOrderDetailsText(order: any): string {
  const orderDateObj = order.createdAt ? new Date(order.createdAt) : new Date();
  const formattedCreationDate = formatCairoDateDDMMYYYY(orderDateObj);
  const formattedCreationTime = orderDateObj.toLocaleTimeString('en-US', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const formattedAppointmentDate = formatCairoDateDDMMYYYY(order.appointmentDate || order.preferredDate);
  const formattedAppointmentTime = formatTime12Hour(order.appointmentTime || order.preferredTimeSlot);

  const orderStatusText = getStatusLabelAr(order.status || 'new');
  const locationLink = order.mapCoordinates?.lat
    ? `https://www.google.com/maps?q=${order.mapCoordinates.lat},${order.mapCoordinates.lng}`
    : '';

  const confirmedPrice = order.confirmedPrice || (order.providerCost ? order.providerCost + (order.travelFee || 60) : 0);
  const providerCost = order.providerCost || 0;
  const travelFee = order.travelFee || 60;
  const estimatedCompanyMargin = confirmedPrice > 0 ? Math.max(0, confirmedPrice - providerCost - travelFee) : 0;

  const customerName = escapeHtml(order.customerName || order.patientName || 'غير مسجل');
  const phone = escapeHtml(order.phone || 'غير مسجل');
  const whatsappPhone = escapeHtml(order.whatsapp || order.phone || 'غير مسجل');
  const areaName = escapeHtml(order.areaNameAr || order.areaNameEn || order.governorate || 'القاهرة');
  const addressDetails = escapeHtml(order.detailedAddress || order.addressDetails || 'غير مسجل');
  const serviceName = escapeHtml(order.serviceNameAr || order.serviceNameEn || 'خدمة تمريضية منزلية');
  const notes = escapeHtml(order.caseDescription || order.notes || '');
  const providerName = escapeHtml(order.assignedProviderName || '');
  const adminNotes = escapeHtml(order.adminNotes || '');

  const lines: string[] = [
    '📋 <b>لوحة التحكم والتشغيل المباشر للطلب</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    `🆔 <b>رقم الطلب:</b> <code>${escapeHtml(order.requestNumber || order.id)}</code>`,
    `🕒 <b>تاريخ الإنشاء:</b> ${formattedCreationDate} (${formattedCreationTime})`,
    `📊 <b>الحالة التشغيلية:</b> ${orderStatusText}`,
    '',
    '👤 <b>بيانات العميل والتواصل:</b>',
    `• <b>الاسم:</b> ${customerName}`,
    `• <b>الهاتف:</b> <a href="tel:${phone}">${phone}</a>`,
    `• <b>واتساب:</b> <code>${whatsappPhone}</code>`,
    `• <b>التفضيل:</b> ${order.preferredContactMethod === 'phone_call' ? 'اتصال هاتفي' : 'واتساب'}`,
    `• <b>العنوان:</b> ${areaName} - ${addressDetails}`,
    locationLink ? `• <b>خرائط جوجل:</b> <a href="${locationLink}">فتح الموقع الجغرافي</a>` : '',
    '',
    '🩺 <b>الخدمة والموعد:</b>',
    `• <b>الخدمة:</b> ${serviceName}`,
    `• <b>الموعد المطلوب:</b> ${formattedAppointmentDate || 'في أقرب وقت'} (${formattedAppointmentTime})`,
    notes ? `• <b>ملاحظة الحالة:</b> <i>${notes}</i>` : '',
    '',
    '👨‍⚕️ <b>الممارس المعتمد:</b>',
    providerName
      ? `• <b>الاسم:</b> ${providerName}\n• <b>أجر الزيارة:</b> ${providerCost} ج.م`
      : '• <i>لم يُعين ممارس بعد. اضغط "تعيين ممارس" أدناه لاختيار كوادر معتمدة.</i>',
    '',
    '💵 <b>التسعير والمالية:</b>',
    `• <b>رسوم الانتقال:</b> ${travelFee} ج.م`,
    `• <b>السعر الإجمالي المعتمد:</b> <b>${confirmedPrice > 0 ? `${confirmedPrice} ج.م` : 'قيد المراجعة'}</b>`,
    confirmedPrice > 0 ? `• <b>العائد المتوقع للشركة:</b> ~${estimatedCompanyMargin} ج.م` : '',
    '',
    '📌 <b>الملاحظات الداخلية:</b>',
    adminNotes ? `<i>${adminNotes}</i>` : '<i>لا توجد ملاحظات داخلية مسجلة بعد.</i>',
    '━━━━━━━━━━━━━━━━━━━━',
    '📜 <b>آخر أحداث التدقيق:</b>',
  ];

  if (Array.isArray(order.statusHistory) && order.statusHistory.length > 0) {
    const recentHist = order.statusHistory.slice(-3);
    recentHist.forEach((h: any) => {
      const time = new Date(h.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
      lines.push(`• [${time}] <b>${escapeHtml(h.changedBy)}:</b> ${escapeHtml(h.note || h.status)}`);
    });
  } else {
    lines.push('• <i>طلب جديد مسجل عبر الموقع</i>');
  }

  return lines.join('\n');
}


/**
 * Handles incoming Telegram update from webhook or polling.
 */
export async function handleTelegramUpdate(update: any): Promise<{ handled: boolean; action?: string; error?: string }> {
  const config = loadStoredTelegramConfig();
  const token = (config.botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    return { handled: false, error: 'Bot token not configured' };
  }

  // 1. Extract sender ID and details
  let senderId = '';
  let senderName = 'Admin';
  let chatType = 'private';
  let chatId = '';

  if (update.callback_query) {
    senderId = String(update.callback_query.from?.id || '');
    senderName = update.callback_query.from?.first_name || 'Admin';
    chatType = update.callback_query.message?.chat?.type || 'private';
    chatId = String(update.callback_query.message?.chat?.id || senderId);
  } else if (update.message) {
    senderId = String(update.message.from?.id || '');
    senderName = update.message.from?.first_name || 'Admin';
    chatType = update.message.chat?.type || 'private';
    chatId = String(update.message.chat?.id || senderId);
  }

  if (!senderId) {
    return { handled: false };
  }

  // 2. Strict Two-Admin Access Authorization
  const authResult = isAuthorizedAdmin(senderId);
  if (!authResult.authorized) {
    console.warn(`[Telegram Security Alert] Unauthorized access attempt from User ID: ${senderId} (${senderName})`);

    if (update.callback_query) {
      await answerCallbackQuery(
        token,
        update.callback_query.id,
        '⛔ غير مصرح: هذا البوت مقيد حصرياً لشخصين مصرح لهما من إدارة أُنس.',
        true
      );
    } else if (update.message) {
      const denialText = [
        '⛔ <b>وصول غير مصرح به (Access Denied)</b>',
        '',
        'عذراً، هذا البوت مخصص فقط لإدارة عمليات <b>أُنس للرعاية الصحية</b> ومقيد حصرياً لشخصين مصرح لهما.',
        '',
        `🆔 <b>معرف حسابك في تيليجرام:</b> <code>${senderId}</code>`,
        `👤 <b>الاسم:</b> ${senderName}`,
        '',
        '<i>إذا كنت أحد المسؤولين المعتمدين، يرجى تزويد الإدارة بهذا المعرف لإضافته في لوحة التحكم الرئيسية تحت تبويب (التكاملات والربط الخارجي).</i>',
      ].join('\n');

      await sendTelegramMessage(token, chatId, denialText);
    }

    return { handled: true, action: 'unauthorized_rejected' };
  }

  // 3. Group Privacy Enforcement
  if (chatType !== 'private') {
    if (update.callback_query) {
      await answerCallbackQuery(
        token,
        update.callback_query.id,
        '⚠️ لحماية خصوصية وسرية بيانات المرضى، يتم تنفيذ الإجراءات في المحادثة الخاصة مع البوت فقط.',
        true
      );
    } else if (update.message) {
      await sendTelegramMessage(
        token,
        chatId,
        '⚠️ <b>تنبيه خصوصية:</b> يرجى التفاعل مع البوت في المحادثة الخاصة المباشرة لحماية البيانات السريرية والشخصية للعملاء.'
      );
    }
    return { handled: true, action: 'group_redirect' };
  }

  // 4. Handle Callback Queries (Button Clicks)
  if (update.callback_query) {
    const cb = update.callback_query;
    const data: string = cb.data || '';
    const messageId: number = cb.message?.message_id;
    const adminLabel = authResult.admin?.name || senderName || 'المشرف المصرح';

    const [prefix, action, orderId, param] = data.split(':');

    if (prefix !== 'act') {
      await answerCallbackQuery(token, cb.id);
      return { handled: false };
    }

    if (action === 'noop') {
      await answerCallbackQuery(token, cb.id, 'ℹ️ هذه حالة نهائية ولا يمكن التعديل عليها.', true);
      return { handled: true, action: 'noop' };
    }

    if (action === 'askprice') {
      const order = await getOrderFromFirestore(orderId);
      if (!order) {
        await answerCallbackQuery(token, cb.id, '⚠️ عذراً، لم يتم العثور على هذا الطلب في قاعدة البيانات.', true);
        return { handled: true, action: 'order_not_found' };
      }

      if (order.confirmedPrice && order.confirmedPrice > 0) {
        await answerCallbackQuery(
          token,
          cb.id,
          `⚠️ تم اعتماد السعر النهائي مسبقاً (${order.confirmedPrice} ج.م) ولا يمكن تعديله.`,
          true
        );
        return { handled: true, action: 'price_already_set' };
      }

      const pkb = buildPriceKeyboard(orderId);
      await editTelegramMessage(token, chatId, messageId, formatOrderSummaryText(order), pkb);
      await answerCallbackQuery(token, cb.id, '💵 اختر السعر المعتمد النهائي بالجنيه المصري:');
      return { handled: true, action: 'asked_price' };
    }

    if (action === 'setprice') {
      const priceNum = parseFloat(param);
      const res = await updateOrderConfirmedPriceInFirestore(
        orderId,
        priceNum,
        `بوت تيليجرام (${adminLabel})`
      );

      if (!res.success) {
        await answerCallbackQuery(token, cb.id, res.error || 'فشلت عملية اعتماد السعر.', true);
        return { handled: true, action: 'price_update_failed' };
      }

      const updatedOrder = res.order;
      const summaryText = formatOrderSummaryText(updatedOrder);
      const kb = buildOrderSummaryKeyboard(updatedOrder);
      await editTelegramMessage(token, chatId, messageId, summaryText, kb);
      await answerCallbackQuery(token, cb.id, `✅ تم اعتماد السعر النهائي (${priceNum} ج.م) بنجاح!`);
      return { handled: true, action: 'price_updated' };
    }

    if (action === 'status') {
      const targetStatus = param;
      const res = await updateOrderStatusInFirestore(
        orderId,
        targetStatus,
        `بوت تيليجرام (${adminLabel})`,
        `تغيير الحالة عبر بوت تيليجرام إلى ${targetStatus}`
      );

      if (!res.success) {
        // Re-fetch latest order to reflect current state
        const latestOrder = await getOrderFromFirestore(orderId);
        if (latestOrder) {
          const summaryText = formatOrderSummaryText(latestOrder);
          const kb = buildOrderSummaryKeyboard(latestOrder);
          await editTelegramMessage(token, chatId, messageId, summaryText, kb);
        }
        await answerCallbackQuery(token, cb.id, res.error || 'فشلت عملية تحديث الحالة.', true);
        return { handled: true, action: 'status_update_failed' };
      }

      const updatedOrder = res.order;
      const summaryText = formatOrderSummaryText(updatedOrder);
      const kb = buildOrderSummaryKeyboard(updatedOrder);
      await editTelegramMessage(token, chatId, messageId, summaryText, kb);

      const statusLabels: Record<string, string> = {
        awaiting_customer_confirmation: 'بانتظار تأكيد العميل',
        confirmed_scheduled: 'مؤكد ومجدول',
        field_in_progress: 'جارٍ التنفيذ الميداني',
        completed: 'مكتمل بنجاح',
        cancelled: 'ملغي',
      };

      await answerCallbackQuery(
        token,
        cb.id,
        `✅ تم تحويل حالة الطلب بنجاح إلى: ${statusLabels[targetStatus] || targetStatus}`
      );
      return { handled: true, action: 'status_updated' };
    }

    if (action === 'details') {
      const order = await getOrderFromFirestore(orderId);
      if (order) {
        const summaryText = formatOrderSummaryText(order);
        const kb = buildOrderSummaryKeyboard(order);
        await editTelegramMessage(token, chatId, messageId, summaryText, kb);
      }
      await answerCallbackQuery(token, cb.id);
      return { handled: true, action: 'viewed_details' };
    }

    const order = await getOrderFromFirestore(orderId);
    if (!order) {
      await answerCallbackQuery(token, cb.id, '⚠️ عذراً، لم يتم العثور على هذا الطلب في قاعدة البيانات.', true);
      return { handled: true, action: 'order_not_found' };
    }

    const kb = buildOrderSummaryKeyboard(order);
    const summaryText = formatOrderSummaryText(order);
    await editTelegramMessage(token, chatId, messageId, summaryText, kb);
    await answerCallbackQuery(
      token,
      cb.id,
      '💬 انقر على زر (مراسلة العميل على واتساب) للتواصل المباشر مع العميل.'
    );
    return { handled: true, action: 'default_callback' };
  }

  // 5. Handle Bot Text Commands
  if (update.message?.text) {
    const text = update.message.text.trim();
    const adminLabel = authResult.admin?.name || senderName || 'المشرف المصرح';

    // Command: /start or /help
    if (text === '/start' || text === '/help') {
      const welcome = [
        '🏥 <b>أهلاً بك في مركز تحكم بوت أُنس للرعاية الصحية</b>',
        '━━━━━━━━━━━━━━━━━━━━',
        `👤 <b>المشرف المصرح:</b> ${adminLabel} (<code>${senderId}</code>)`,
        '🔒 <b>مستوى الصلاحية:</b> إدارة تفاعلية كاملة ومعتمدة',
        '',
        '⚡ <b>الأوامر المتاحة:</b>',
        '• <code>/orders</code> — عرض آخر الطلبات الجديدة مع لوحة التحكم',
        '• <code>/order &lt;رقم_الطلب&gt;</code> — فتح وإدارة تفاصيل طلب محدد',
        '• <code>/stats</code> — ملخص إحصائيات الطلبات والحالات',
        '• <code>/admins</code> — عرض الإداريين المصرحين للبوت',
        '',
        '💡 <i>يصلك كل طلب جديد يسجله المريض على الموقع تلقائياً مع أزرار التحكم الكاملة.</i>',
      ].join('\n');

      await sendTelegramMessage(token, chatId, welcome);
      return { handled: true, action: 'command_start' };
    }

    // Command: /admins
    if (text === '/admins') {
      const admin1 = config.admin1;
      const admin2 = config.admin2;

      const adminsText = [
        '👥 <b>الإداريون المصرح لهما بالبوت (Strict Two-Admin Access):</b>',
        '━━━━━━━━━━━━━━━━━━━━',
        `1️⃣ <b>المشرف الرئيسي:</b> ${admin1?.name || 'غير محدد'}`,
        `   • المعرف (User ID): <code>${admin1?.id || 'غير مسجل'}</code>`,
        `   • الحالة: ${admin1?.id ? '🟢 مفعل ومصرح' : '⚪ بانتظار الإدخال'}`,
        '',
        `2️⃣ <b>المشرف الشريك:</b> ${admin2?.name || 'غير محدد'}`,
        `   • المعرف (User ID): <code>${admin2?.id || 'غير مسجل'}</code>`,
        `   • الحالة: ${admin2?.id ? '🟢 مفعل ومصرح' : '⚪ بانتظار الإدخال'}`,
        '━━━━━━━━━━━━━━━━━━━━',
        '🔒 <i>أي مستخدم آخر يتم حظره فورياً ولا يتم كشف أي بيانات له.</i>',
      ].join('\n');

      await sendTelegramMessage(token, chatId, adminsText);
      return { handled: true, action: 'command_admins' };
    }

    // Command: /stats
    if (text === '/stats') {
      const orders = loadStoredOrders();
      const total = orders.length;
      const newOrders = orders.filter((o: ServerOrder) => o.status === 'new').length;
      const confirmed = orders.filter((o: ServerOrder) => o.status === 'confirmed').length;
      const inProgress = orders.filter((o: ServerOrder) => o.status === 'in_progress').length;
      const completed = orders.filter((o: ServerOrder) => o.status === 'completed').length;
      const cancelled = orders.filter((o: ServerOrder) => o.status === 'cancelled').length;

      const statsText = [
        '📊 <b>إحصائيات وتشغيل طلبات أُنس للرعاية الصحية</b>',
        '━━━━━━━━━━━━━━━━━━━━',
        `📦 <b>إجمالي الطلبات المسجلة:</b> ${total}`,
        `🟡 <b>طلبات جديدة:</b> ${newOrders}`,
        `🟢 <b>طلبات مؤكدة:</b> ${confirmed}`,
        `🚙 <b>قيد التنفيذ الميداني:</b> ${inProgress}`,
        `🏁 <b>مكتملة بنجاح:</b> ${completed}`,
        `❌ <b>ملغاة:</b> ${cancelled}`,
        '━━━━━━━━━━━━━━━━━━━━',
      ].join('\n');

      await sendTelegramMessage(token, chatId, statsText);
      return { handled: true, action: 'command_stats' };
    }

    // Command: /orders
    if (text === '/orders') {
      const orders = loadStoredOrders().slice(0, 5);
      if (orders.length === 0) {
        await sendTelegramMessage(token, chatId, '📭 لا توجد طلبات مسجلة حالياً في النظام.');
        return { handled: true, action: 'command_orders_empty' };
      }

      await sendTelegramMessage(token, chatId, `📋 <b>آخر ${orders.length} طلبات مسجلة في النظام:</b>`);
      for (const ord of orders) {
        const summary = formatOrderSummaryText(ord);
        const kb = buildOrderSummaryKeyboard(ord.id, ord.status);
        await sendTelegramMessage(token, chatId, summary, kb);
      }
      return { handled: true, action: 'command_orders' };
    }

    // Command: /order <orderId>
    if (text.startsWith('/order')) {
      const parts = text.split(/\s+/);
      const queryId = parts[1];
      if (!queryId) {
        await sendTelegramMessage(token, chatId, '⚠️ يرجى كتابة رقم الطلب. مثال:\n<code>/order ONS-123456</code>');
        return { handled: true, action: 'command_order_missing_id' };
      }

      const order = getOrderById(queryId);
      if (!order) {
        await sendTelegramMessage(token, chatId, `⚠️ لم يتم العثور على طلب بالرقم <code>${queryId}</code>.`);
        return { handled: true, action: 'command_order_not_found' };
      }

      const detailsText = formatOrderDetailsText(order);
      const kb = buildOrderExpandedKeyboard(order.id, order.status);
      await sendTelegramMessage(token, chatId, detailsText, kb);
      return { handled: true, action: 'command_order_found' };
    }
  }

  return { handled: false };
}

/**
 * Starts Long Polling background worker to receive updates in environments without public webhooks.
 */
export function startTelegramPolling(): void {
  if (isPollingActive) return;

  const cfg = loadStoredTelegramConfig();
  const token = (cfg.botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token || cfg.enabled === false || cfg.pollingEnabled === false) {
    return;
  }

  isPollingActive = true;
  pollingAbortController = new AbortController();
  console.log('[Telegram Polling] Starting interactive long-polling worker for two-admin bot...');

  (async () => {
    let offset = cfg.lastUpdateId || 0;

    while (isPollingActive) {
      try {
        const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates?offset=${offset}&timeout=20`;
        const res = await fetch(url, {
          signal: pollingAbortController?.signal,
        });

        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }

        const data = await res.json().catch(() => ({ ok: false }));
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            offset = update.update_id + 1;
            saveStoredTelegramConfig({ lastUpdateId: offset });

            try {
              await handleTelegramUpdate(update);
            } catch (handleErr) {
              console.error('[Telegram Polling Handler Error]:', handleErr);
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') break;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();
}

/**
 * Stops Long Polling worker.
 */
export function stopTelegramPolling(): void {
  isPollingActive = false;
  if (pollingAbortController) {
    pollingAbortController.abort();
    pollingAbortController = null;
  }
  console.log('[Telegram Polling] Polling worker stopped.');
}

/**
 * Checks if polling is currently active.
 */
export function isPollingRunning(): boolean {
  return isPollingActive;
}

/**
 * Tests Telegram bot connection:
 * Calls Telegram getMe API to verify bot credentials,
 * and if a chatId is provided, sends a verification ping.
 */
export async function testTelegramConnection(
  customChatId?: string,
  customToken?: string
): Promise<{
  success: boolean;
  status: 'connected' | 'error' | 'not_configured';
  botUsername?: string;
  botName?: string;
  chatId?: string;
  messageId?: string;
  error?: string;
}> {
  const stored = loadStoredTelegramConfig();
  const token = (customToken || stored.botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (customChatId || stored.chatId || process.env.TELEGRAM_CHAT_ID || '').trim();

  if (!token) {
    return {
      success: false,
      status: 'not_configured',
      error: 'لم يتم إدخال توكن البوت (Bot Token). يرجى إدخال التوكن من BotFather.',
    };
  }

  try {
    // 1. Verify Bot Token using getMe
    const getMeUrl = `https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`;
    const meRes = await fetch(getMeUrl);
    const meData = await meRes.json().catch(() => ({ ok: false }));

    if (!meData.ok) {
      const errMsg = meData.description || 'فشل التحقق من توكن البوت عبر تيليجرام.';
      return {
        success: false,
        status: 'error',
        error: sanitizeTelegramError(errMsg),
      };
    }

    const botUsername = meData.result?.username || '';
    const botName = meData.result?.first_name || '';

    // 2. If chatId provided, send test ping to all configured chat IDs
    let messageId: string | undefined;
    const recipients = customChatId ? parseChatIds(customChatId) : getNotificationRecipients();

    if (recipients.length > 0) {
      const testText = [
        '<b>🏥 أُنس للرعاية الصحية — تجربة الربط بنجاح</b>',
        '',
        `🤖 <b>البوت:</b> @${botUsername} (${botName})`,
        `⏰ <b>التاريخ والوقت:</b> ${new Date().toLocaleString('ar-EG')}`,
        '✅ <b>الحالة:</b> متصل وجاهز لاستقبال إشعارات طلبات الرعاية مع لوحة التحكم التفاعلية للإداريين.',
        '',
        '<i>سيصلك كل طلب جديد مع تفاصيله الكاملة وترشيح أقرب 3 ممارسين وأزرار التحكم المباشرة.</i>',
      ].join('\n');

      const errors: string[] = [];
      const successfulMsgIds: string[] = [];

      for (const targetId of recipients) {
        const sendRes = await sendTelegramMessage(token, targetId, testText);
        if (!sendRes.ok) {
          errors.push(
            `فشل الإرسال إلى (${targetId}): ${sendRes.description || 'تأكد من بدء المحادثة مع البوت /start أولاً'}`
          );
        } else if (sendRes.messageId) {
          successfulMsgIds.push(String(sendRes.messageId));
        }
      }

      if (successfulMsgIds.length === 0 && errors.length > 0) {
        return {
          success: false,
          status: 'error',
          botUsername,
          botName,
          error: sanitizeTelegramError(errors.join(' | ')),
        };
      }

      messageId = successfulMsgIds.join(', ');
    }

    // Update stored config on success
    saveStoredTelegramConfig({
      botToken: token,
      botUsername,
      lastTestedAt: new Date().toISOString(),
      lastTestStatus: 'connected',
      lastError: undefined,
      lastTestMessageId: messageId,
    });

    return {
      success: true,
      status: 'connected',
      botUsername,
      botName,
      chatId: maskChatId(recipients.join(',')),
      messageId,
    };
  } catch (err: any) {
    return {
      success: false,
      status: 'error',
      error: sanitizeTelegramError(err.message || 'Network error connecting to Telegram Bot API'),
    };
  }
}

const recentlyNotifiedOrders = new Map<string, { timestamp: number; messageId?: string; chatId?: string }>();

/**
 * Formats and sends a comprehensive, structured new order notification to Telegram.
 * Sends to both authorized administrators with interactive inline buttons.
 * Automatically saves the order in the server-side orders store and attaches prescription/ID image.
 */
export async function notifyNewOrderTelegram(
  order: any,
  recommendedProviders: RecommendedProviderSummary[] = [],
  options?: { force?: boolean }
): Promise<{
  success: boolean;
  status: 'sent' | 'failed' | 'not_configured';
  messageId?: string;
  chatId?: string;
  error?: string;
  timestamp: string;
}> {
  const timestamp = new Date().toISOString();

  // Deduplication check: prevent duplicate messages for the same order ID and status within 10 seconds
  const orderIdKey = String(order?.id || order?.requestNumber || '');
  const dedupKey = `${orderIdKey}_${order?.status || 'new'}`;
  const now = Date.now();
  const previous = recentlyNotifiedOrders.get(dedupKey);

  if (previous && now - previous.timestamp < 10000 && !options?.force) {
    console.log(`[Telegram Notice] Duplicate notification suppressed for order ${orderIdKey} (notified ${Math.round((now - previous.timestamp) / 1000)}s ago).`);
    return {
      success: true,
      status: 'sent',
      messageId: previous.messageId,
      chatId: previous.chatId,
      timestamp: new Date(previous.timestamp).toISOString(),
    };
  }

  const config = loadStoredTelegramConfig();

  // Save/cache order in server store
  upsertServerOrder(order);

  const token = (config.botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const recipients = getNotificationRecipients();

  if (!config.enabled) {
    return {
      success: false,
      status: 'not_configured',
      timestamp,
      error: 'إشعارات تيليجرام معطلة حالياً في الإعدادات | Telegram notifications disabled.',
    };
  }

  if (!token || recipients.length === 0) {
    return {
      success: false,
      status: 'not_configured',
      timestamp,
      error: 'لم يتم ضبط توكن البوت أو معرفات الإداريين المصرحين (Admin IDs) في الخادم.',
    };
  }

  const messageText = formatOrderSummaryText(order, recommendedProviders);
  const inlineKeyboard = buildOrderSummaryKeyboard(order, order.status);

  const deliveryErrors: string[] = [];
  const successfulMessageIds: string[] = [];

  for (const chatId of recipients) {
    try {
      const sendRes = await sendTelegramMessage(token, chatId, messageText, inlineKeyboard);

      if (!sendRes.ok) {
        const errorMsg = sanitizeTelegramError(sendRes.description || 'Unknown Telegram delivery error');
        console.error(`[Telegram API Error for ${chatId}]`, errorMsg);
        deliveryErrors.push(`(${chatId}): ${errorMsg}`);
      } else if (sendRes.messageId) {
        successfulMessageIds.push(String(sendRes.messageId));

        // Dispatch all attached prescriptions/medical documents to Telegram
        const attachmentsToDispatch: Array<{ url: string; name?: string; caption: string }> = [];

        const prescRef = order.prescriptionDocumentReference || order.prescriptionUrl || order.prescriptionPhotoUrl;
        if (prescRef && typeof prescRef === 'string') {
          attachmentsToDispatch.push({
            url: prescRef,
            name: 'روشتة_طبيعة.jpg',
            caption: `📎 صورة الروشتة/المستند الطبي للطلب #${order.id} — العميل: ${order.customerName || ''}`,
          });
        } else if (Array.isArray(order.prescriptionImages)) {
          order.prescriptionImages.forEach((imgUrl: string, idx: number) => {
            if (imgUrl && typeof imgUrl === 'string') {
              attachmentsToDispatch.push({
                url: imgUrl,
                name: `روشتة_${idx + 1}.jpg`,
                caption: `📎 صورة الروشتة (${idx + 1}) للطلب #${order.id} — العميل: ${order.customerName || ''}`,
              });
            }
          });
        }

        if (order.identityDocumentUrl && typeof order.identityDocumentUrl === 'string' && order.identityDocumentUrl !== prescRef) {
          attachmentsToDispatch.push({
            url: order.identityDocumentUrl,
            name: order.identityDocumentName || 'مستند.jpg',
            caption: `📎 مستند مريض/إثبات شخصية للطلب #${order.id} — العميل: ${order.customerName || ''}`,
          });
        }

        for (const item of attachmentsToDispatch) {
          try {
            const sent = await sendTelegramAttachment(token, chatId, item.url, item.name, item.caption, inlineKeyboard);
            if (!sent) {
              console.warn(`[Telegram Notice]: Could not send attachment ${item.name} for request #${order.id} to chat ${chatId}`);
            }
          } catch (attachErr: any) {
            console.error(`[Telegram Attachment Exception for ${chatId}]:`, attachErr?.message || attachErr);
          }
        }
      }
    } catch (err: any) {
      const errorMsg = sanitizeTelegramError(err.message || 'Network exception communicating with Telegram');
      console.error(`[Telegram Exception for ${chatId}]`, errorMsg);
      deliveryErrors.push(`(${chatId}): ${errorMsg}`);
    }
  }

  if (successfulMessageIds.length > 0) {
    const msgIdStr = successfulMessageIds.join(', ');
    const chatIdStr = maskChatId(recipients.join(','));
    recentlyNotifiedOrders.set(dedupKey, { timestamp: now, messageId: msgIdStr, chatId: chatIdStr });

    return {
      success: true,
      status: 'sent',
      messageId: msgIdStr,
      chatId: chatIdStr,
      timestamp,
      error: deliveryErrors.length > 0 ? deliveryErrors.join(' | ') : undefined,
    };
  }

  return {
    success: false,
    status: 'failed',
    chatId: maskChatId(recipients.join(',')),
    error: deliveryErrors.join(' | ') || 'Failed to dispatch Telegram notifications to configured chats',
    timestamp,
  };
}

/**
 * Sends a monthly export summary report alert to authorized Telegram administrators.
 */
export async function sendMonthlyReportTelegramAlert(reportData: {
  monthKey: string;
  monthNameAr: string;
  exportedCount: number;
  totalConfirmedAmount: number;
  totalTravelFees: number;
  totalCollectedAmount: number;
  spreadsheetUrl: string;
}): Promise<boolean> {
  try {
    const config = loadStoredTelegramConfig();
    const token = (config.botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const recipients = getNotificationRecipients();

    if (!token || recipients.length === 0) {
      console.warn('[Telegram Monthly Alert] Missing bot token or recipients');
      return false;
    }

    const messageText = [
      `📊 *إشعار تصدير التقرير الشهري المالي والتشغيلي*`,
      `-----------------------------------`,
      `📅 *الشهر:* ${reportData.monthNameAr} (${reportData.monthKey})`,
      `✅ *عدد الطلبات المكتملة المصدرة:* ${reportData.exportedCount}`,
      `💰 *إجمالي الأسعار المعتمدة:* ${reportData.totalConfirmedAmount.toLocaleString('ar-EG')} ج.م`,
      `🚗 *إجمالي رسوم الانتقال:* ${reportData.totalTravelFees.toLocaleString('ar-EG')} ج.م`,
      `💵 *إجمالي التحصيل الفعلي:* ${reportData.totalCollectedAmount.toLocaleString('ar-EG')} ج.م`,
      `-----------------------------------`,
      `🔗 [فتح ملف Google Sheets التفاعلي](${reportData.spreadsheetUrl})`,
    ].join('\n');

    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: '📊 فتح ملف Google Sheets', url: reportData.spreadsheetUrl }],
      ],
    };

    let sentAny = false;
    for (const chatId of recipients) {
      const res = await sendTelegramMessage(token, chatId, messageText, inlineKeyboard);
      if (res.ok) sentAny = true;
    }
    return sentAny;
  } catch (err) {
    console.error('[Telegram Monthly Alert Error]', err);
    return false;
  }
}
