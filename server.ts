import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import {
  notifyNewOrder,
  testConnection,
  getAuditLogs,
  maskToken,
  validatePhoneNumber,
  sanitizeErrorMessage,
  NotifyOrderOptions,
} from './src/server/whatsappService.js';
import {
  loadStoredTelegramConfig,
  saveStoredTelegramConfig,
  maskTelegramToken,
  maskChatId,
  testTelegramConnection,
  notifyNewOrderTelegram,
  sanitizeTelegramError,
  sendMonthlyReportTelegramAlert,
} from './src/server/telegramService.js';
import {
  loadMonthlySheetsConfig,
  saveMonthlySheetsConfig,
  getCompletedOrdersForMonth,
  processMonthlyExportToSheets,
  calculateCairoMonthRange,
} from './src/server/monthlyReportService.js';
import { loadStoredOrders } from './src/server/ordersStore.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

// Persistent server-side WhatsApp configuration file
const CONFIG_FILE = path.resolve(__dirname, 'whatsapp-config.json');

export interface StoredWhatsAppConfig {
  enabled: boolean;
  recipientAPhone: string;
  recipientBPhone: string;
  recipientAName?: string;
  recipientBName?: string;
  defaultLanguage: 'ar' | 'en';
  lastTestedAt?: string;
  lastTestStatus?: 'connected' | 'error' | 'not_configured';
  lastError?: string;
  lastTestMessageId?: string;
}

function loadStoredConfig(): StoredWhatsAppConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[Server] Could not read whatsapp-config.json:', err);
  }
  return {
    enabled: true,
    recipientAPhone: process.env.WHATSAPP_RECIPIENT_A || '',
    recipientBPhone: process.env.WHATSAPP_RECIPIENT_B || '',
    defaultLanguage: 'ar',
  };
}

function saveStoredConfig(cfg: Partial<StoredWhatsAppConfig>): StoredWhatsAppConfig {
  const current = loadStoredConfig();
  const updated: StoredWhatsAppConfig = { ...current, ...cfg };
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Server] Could not save whatsapp-config.json:', err);
  }
  return updated;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // -------------------------------------------------------------
  // WhatsApp Business Cloud API Endpoints
  // -------------------------------------------------------------

  /**
   * GET /api/whatsapp/config
   * Returns current server configuration state (with credentials securely masked)
   */
  app.get('/api/whatsapp/config', (_req: Request, res: Response) => {
    const stored = loadStoredConfig();
    const token = process.env.WHATSAPP_API_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'ons_new_order_alert';

    const isConfigured = Boolean(token && phoneId);

    res.json({
      success: true,
      enabled: stored.enabled,
      recipientAPhone: stored.recipientAPhone,
      recipientBPhone: stored.recipientBPhone,
      recipientAName: stored.recipientAName || '',
      recipientBName: stored.recipientBName || '',
      defaultLanguage: stored.defaultLanguage || 'ar',
      templateName,
      isConfigured,
      hasToken: Boolean(token),
      hasPhoneNumberId: Boolean(phoneId),
      phoneNumberId: phoneId ? `${phoneId.substring(0, 4)}••••` : '',
      tokenMasked: maskToken(token),
      businessAccountId: accountId || '',
      lastTestedAt: stored.lastTestedAt || null,
      lastTestStatus: stored.lastTestStatus || (isConfigured ? 'untested' : 'not_configured'),
      lastError: stored.lastError || null,
      lastTestMessageId: stored.lastTestMessageId || null,
    });
  });

  /**
   * POST /api/whatsapp/config
   * Updates admin-configured Recipient A and Recipient B phone numbers & toggles
   */
  app.post('/api/whatsapp/config', (req: Request, res: Response) => {
    const {
      recipientAPhone,
      recipientBPhone,
      recipientAName,
      recipientBName,
      enabled,
      defaultLanguage,
    } = req.body;

    // Validate Recipient A phone if provided
    if (recipientAPhone && typeof recipientAPhone === 'string' && recipientAPhone.trim()) {
      const vA = validatePhoneNumber(recipientAPhone);
      if (!vA.valid) {
        return res.status(400).json({
          success: false,
          error: `رقم المستلم أ غير صالح: ${vA.reason} | Invalid Recipient A phone number.`,
        });
      }
    }

    // Validate Recipient B phone if provided
    if (recipientBPhone && typeof recipientBPhone === 'string' && recipientBPhone.trim()) {
      const vB = validatePhoneNumber(recipientBPhone);
      if (!vB.valid) {
        return res.status(400).json({
          success: false,
          error: `رقم المستلم ب غير صالح: ${vB.reason} | Invalid Recipient B phone number.`,
        });
      }
    }

    const updated = saveStoredConfig({
      recipientAPhone: typeof recipientAPhone === 'string' ? recipientAPhone.trim() : undefined,
      recipientBPhone: typeof recipientBPhone === 'string' ? recipientBPhone.trim() : undefined,
      recipientAName: typeof recipientAName === 'string' ? recipientAName.trim() : undefined,
      recipientBName: typeof recipientBName === 'string' ? recipientBName.trim() : undefined,
      enabled: typeof enabled === 'boolean' ? enabled : undefined,
      defaultLanguage: defaultLanguage === 'en' ? 'en' : 'ar',
    });

    res.json({
      success: true,
      message: 'تم حفظ وتحديث إعدادات واتساب للأعمال بنجاح في الخادم | WhatsApp settings updated.',
      config: updated,
    });
  });

  /**
   * POST /api/whatsapp/notify-order
   * Triggered when an order is created or when an alert is retried
   */
  app.post('/api/whatsapp/notify-order', async (req: Request, res: Response) => {
    const { order, config, forceRetry, retryTarget } = req.body;

    if (!order || !order.id) {
      return res.status(400).json({
        success: false,
        error: 'Invalid order payload: missing order object or order.id.',
      });
    }

    const stored = loadStoredConfig();
    if (!stored.enabled) {
      return res.json({
        success: false,
        orderId: order.id,
        overallStatus: 'not_configured',
        message: 'إشعارات الواتساب معطلة حالياً في إعدادات الربط | WhatsApp notifications disabled.',
        recipientA: { recipientId: 'recipient_a', phone: stored.recipientAPhone, status: 'not_configured', timestamp: new Date().toISOString() },
        recipientB: { recipientId: 'recipient_b', phone: stored.recipientBPhone, status: 'not_configured', timestamp: new Date().toISOString() },
      });
    }

    // Merge stored recipient configuration with any overrides
    const effectiveConfig: NotifyOrderOptions = {
      recipientAPhone: config?.recipientAPhone || stored.recipientAPhone,
      recipientBPhone: config?.recipientBPhone || stored.recipientBPhone,
      language: config?.language || stored.defaultLanguage || 'ar',
      forceRetry: Boolean(forceRetry || config?.forceRetry),
      retryTarget: retryTarget || config?.retryTarget || 'both',
    };

    try {
      const result = await notifyNewOrder(order, effectiveConfig);
      res.json(result);
    } catch (err: any) {
      const sanitized = sanitizeErrorMessage(err.message || 'Internal server error processing notification.');
      console.error('[WhatsApp Route Error]', sanitized);
      res.status(500).json({
        success: false,
        orderId: order.id,
        overallStatus: 'failed',
        error: sanitized,
      });
    }
  });

  /**
   * POST /api/whatsapp/retry-order
   * Explicit endpoint for retrying an order notification
   */
  app.post('/api/whatsapp/retry-order', async (req: Request, res: Response) => {
    const { order, retryTarget } = req.body;

    if (!order || !order.id) {
      return res.status(400).json({
        success: false,
        error: 'Missing order data for retry.',
      });
    }

    const stored = loadStoredConfig();
    const effectiveConfig: NotifyOrderOptions = {
      recipientAPhone: stored.recipientAPhone,
      recipientBPhone: stored.recipientBPhone,
      language: stored.defaultLanguage || 'ar',
      forceRetry: true,
      retryTarget: retryTarget || 'both',
    };

    try {
      const result = await notifyNewOrder(order, effectiveConfig);
      res.json(result);
    } catch (err: any) {
      const sanitized = sanitizeErrorMessage(err.message || 'Internal server error during retry.');
      res.status(500).json({
        success: false,
        orderId: order.id,
        overallStatus: 'failed',
        error: sanitized,
      });
    }
  });

  /**
   * POST /api/whatsapp/test
   * Runs a genuine live connection test with Meta Graph API
   */
  app.post('/api/whatsapp/test', async (req: Request, res: Response) => {
    const { testPhone } = req.body;
    // Only dispatch test message if a specific recipient was explicitly provided in the request
    const phoneToTest = typeof testPhone === 'string' && testPhone.trim() ? testPhone.trim() : undefined;

    const result = await testConnection(phoneToTest);

    // Save test result in stored configuration
    saveStoredConfig({
      lastTestedAt: new Date().toISOString(),
      lastTestStatus: result.status,
      lastError: result.error ? sanitizeErrorMessage(result.error) : undefined,
      lastTestMessageId: result.messageId || undefined,
    });

    res.json(result);
  });

  /**
   * GET /api/whatsapp/logs
   * Retrieves recent notification audit records
   */
  app.get('/api/whatsapp/logs', (_req: Request, res: Response) => {
    const logs = getAuditLogs();
    res.json({
      success: true,
      logs,
    });
  });

  // -------------------------------------------------------------
  // Telegram Bot API Endpoints
  // -------------------------------------------------------------

  /**
   * GET /api/telegram/config
   * Returns current Telegram bot configuration with masked token and admin IDs
   */
  app.get('/api/telegram/config', (_req: Request, res: Response) => {
    const stored = loadStoredTelegramConfig();
    const token = stored.botToken || process.env.TELEGRAM_BOT_TOKEN || '';
    const chatId = stored.chatId || process.env.TELEGRAM_CHAT_ID || '';
    const isConfigured = Boolean(token.trim() && (chatId.trim() || stored.admin1?.id || stored.admin2?.id));

    res.json({
      success: true,
      enabled: stored.enabled !== false,
      isConfigured,
      hasToken: Boolean(token.trim()),
      tokenMasked: maskTelegramToken(token),
      hasChatId: Boolean(chatId.trim()),
      chatId: chatId ? maskChatId(chatId) : '',
      rawChatIdPresent: Boolean(chatId.trim()),
      chatTitle: stored.chatTitle || '',
      botUsername: stored.botUsername || '',
      lastTestedAt: stored.lastTestedAt || null,
      lastTestStatus: stored.lastTestStatus || (isConfigured ? 'untested' : 'not_configured'),
      lastError: stored.lastError || null,
      lastTestMessageId: stored.lastTestMessageId || null,
      admin1: stored.admin1 || { id: '', name: 'المشرف الرئيسي (Admin 1)', role: 'owner', isVerified: false },
      admin2: stored.admin2 || { id: '', name: 'المشرف الشريك (Admin 2)', role: 'colleague', isVerified: false },
      authorizedUserIds: stored.authorizedUserIds || [],
      pollingEnabled: stored.pollingEnabled !== false,
    });
  });

  /**
   * POST /api/telegram/config
   * Updates Telegram bot token, chat ID, and enabled toggle securely in server storage
   */
  app.post('/api/telegram/config', (req: Request, res: Response) => {
    const { botToken, chatId, chatTitle, enabled } = req.body;

    const patch: Partial<ReturnType<typeof loadStoredTelegramConfig>> = {};
    if (typeof botToken === 'string' && botToken.trim()) {
      patch.botToken = botToken.trim();
    }
    if (typeof chatId === 'string') {
      patch.chatId = chatId.trim();
    }
    if (typeof chatTitle === 'string') {
      patch.chatTitle = chatTitle.trim();
    }
    if (typeof enabled === 'boolean') {
      patch.enabled = enabled;
    }

    const updated = saveStoredTelegramConfig(patch);

    res.json({
      success: true,
      message: 'تم حفظ وتحديث إعدادات بوت تيليجرام بنجاح في الخادم | Telegram configuration updated.',
      config: {
        enabled: updated.enabled,
        isConfigured: Boolean((updated.botToken || '').trim() && ((updated.chatId || '').trim() || updated.admin1?.id || updated.admin2?.id)),
        tokenMasked: maskTelegramToken(updated.botToken),
        chatId: maskChatId(updated.chatId),
        chatTitle: updated.chatTitle || '',
        botUsername: updated.botUsername || '',
        lastTestedAt: updated.lastTestedAt || null,
        lastTestStatus: updated.lastTestStatus || 'untested',
        admin1: updated.admin1,
        admin2: updated.admin2,
        authorizedUserIds: updated.authorizedUserIds,
      },
    });
  });

  /**
   * POST /api/telegram/admins
   * Updates strict two-admin Telegram User IDs for alert delivery & interactive authorization
   */
  app.post('/api/telegram/admins', (req: Request, res: Response) => {
    const { admin1Id, admin1Name, admin2Id, admin2Name } = req.body;

    const id1 = typeof admin1Id === 'string' ? admin1Id.trim() : '';
    const id2 = typeof admin2Id === 'string' ? admin2Id.trim() : '';

    // Validate ID format (must be numeric if provided)
    if (id1 && !/^-?\d+$/.test(id1)) {
      return res.status(400).json({
        success: false,
        error: 'معرّف المشرف الأول يجب أن يتكون من أرقام فقط (Telegram Numeric User ID).',
      });
    }
    if (id2 && !/^-?\d+$/.test(id2)) {
      return res.status(400).json({
        success: false,
        error: 'معرّف المشرف الثاني يجب أن يتكون من أرقام فقط (Telegram Numeric User ID).',
      });
    }

    const currentConfig = loadStoredTelegramConfig();

    const admin1Obj = {
      id: id1,
      name: typeof admin1Name === 'string' && admin1Name.trim() ? admin1Name.trim() : 'المشرف الرئيسي (Admin 1)',
      role: 'owner' as const,
      isVerified: Boolean(id1),
      addedAt: currentConfig.admin1?.addedAt || new Date().toISOString(),
    };

    const admin2Obj = {
      id: id2,
      name: typeof admin2Name === 'string' && admin2Name.trim() ? admin2Name.trim() : 'المشرف الشريك (Admin 2)',
      role: 'colleague' as const,
      isVerified: Boolean(id2),
      addedAt: currentConfig.admin2?.addedAt || new Date().toISOString(),
    };

    const updated = saveStoredTelegramConfig({
      admin1: admin1Obj,
      admin2: admin2Obj,
      authorizedUserIds: [id1, id2].filter(Boolean),
    });

    res.json({
      success: true,
      message: 'تم حفظ وتوثيق معرّفات المشرفين بنجاح ببيانات السيرفر | Authorized Telegram admins updated.',
      admin1: updated.admin1,
      admin2: updated.admin2,
      authorizedUserIds: updated.authorizedUserIds,
    });
  });

  /**
   * POST /api/telegram/polling/toggle
   * Toggles long polling worker for interactive inline keyboard buttons
   */
  app.post('/api/telegram/polling/toggle', (req: Request, res: Response) => {
    const { action } = req.body;
    const current = loadStoredTelegramConfig();
    const shouldEnable = action === 'start' ? true : action === 'stop' ? false : !current.pollingEnabled;
    const updated = saveStoredTelegramConfig({ pollingEnabled: shouldEnable });

    res.json({
      success: true,
      pollingEnabled: updated.pollingEnabled,
      message: `تم ${updated.pollingEnabled ? 'تفعيل' : 'إيقاف'} الاستجابة التفاعلية التلقائية.`,
    });
  });

  /**
   * POST /api/telegram/test
   * Tests Telegram bot connection (getMe + sends test ping if chat ID configured)
   */
  app.post('/api/telegram/test', async (req: Request, res: Response) => {
    const { testChatId, botToken } = req.body;
    const result = await testTelegramConnection(testChatId, botToken);
    res.json(result);
  });

  /**
   * POST /api/telegram/notify-order
   * Automatically sends detailed order notification with up to 3 recommended providers to Telegram
   */
  app.post('/api/telegram/notify-order', async (req: Request, res: Response) => {
    const { order, recommendedProviders } = req.body;

    if (!order || !order.id) {
      return res.status(400).json({
        success: false,
        error: 'Invalid order payload: missing order object or order.id.',
      });
    }

    try {
      const result = await notifyNewOrderTelegram(order, recommendedProviders || []);
      res.json(result);
    } catch (err: any) {
      const sanitized = sanitizeTelegramError(err.message || 'Error processing Telegram order notification');
      console.error('[Telegram Route Error]', sanitized);
      res.status(500).json({
        success: false,
        orderId: order.id,
        status: 'failed',
        error: sanitized,
      });
    }
  });

  // -------------------------------------------------------------
  // Monthly Reporting & Google Sheets Export Endpoints
  // -------------------------------------------------------------

  /**
   * GET /api/reports/monthly-status
   * Returns current Google Sheets export configuration, status logs, and Cairo month info
   */
  app.get('/api/reports/monthly-status', (req: Request, res: Response) => {
    try {
      const cfg = loadMonthlySheetsConfig();
      const currentCairoRange = calculateCairoMonthRange();
      
      const serverOrders = loadStoredOrders();
      const previousMonthCompleted = getCompletedOrdersForMonth(serverOrders, currentCairoRange.monthKey);

      res.json({
        success: true,
        autoCronEnabled: cfg.autoCronEnabled,
        spreadsheetId: cfg.spreadsheetId || null,
        spreadsheetUrl: cfg.spreadsheetUrl || null,
        currentCairoMonth: currentCairoRange,
        previousMonthCompletedCount: previousMonthCompleted.orders.length,
        logs: cfg.logs || {},
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/reports/monthly-export
   * Triggers monthly completed orders export to Google Sheets & Telegram notification
   */
  app.post('/api/reports/monthly-export', async (req: Request, res: Response) => {
    try {
      const { targetMonthKey, accessToken, clientOrders } = req.body;

      // Merge server-stored orders with client orders if passed
      const serverOrders = loadStoredOrders();
      const allOrdersMap = new Map<string, any>();
      
      if (Array.isArray(serverOrders)) {
        serverOrders.forEach((o) => { if (o && o.id) allOrdersMap.set(o.id, o); });
      }
      if (Array.isArray(clientOrders)) {
        clientOrders.forEach((o) => { if (o && o.id) allOrdersMap.set(o.id, o); });
      }

      const mergedOrders = Array.from(allOrdersMap.values());

      const result = await processMonthlyExportToSheets({
        orders: mergedOrders,
        targetMonthKey,
        accessToken,
        telegramNotifier: sendMonthlyReportTelegramAlert,
      });

      res.json({
        success: result.success,
        monthKey: result.log.monthKey,
        monthNameAr: result.log.monthNameAr,
        exportedCount: result.log.exportedCount,
        spreadsheetUrl: result.log.spreadsheetUrl,
        telegramNotified: result.log.telegramNotified || false,
        log: result.log,
      });
    } catch (err: any) {
      console.error('[Monthly Export Route Error]', err);
      res.status(500).json({
        success: false,
        error: `فشل تصدير التقرير الشهري: ${err.message || String(err)}`,
      });
    }
  });

  // -------------------------------------------------------------
  // Mandatory Medical Prescription & Document Upload Endpoints
  // -------------------------------------------------------------

  const UPLOADS_DIR = path.resolve(__dirname, 'uploads/prescriptions');
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  /**
   * POST /api/prescriptions/upload
   * Securely uploads patient prescription / medical document
   */
  app.post('/api/prescriptions/upload', (req: Request, res: Response) => {
    try {
      const { fileData, fileName, mimeType } = req.body;

      if (!fileData) {
        return res.status(400).json({
          success: false,
          error: 'يرجى اختيار ملف المكون السريري أو الروشتة الطبية للمتابعة | Missing fileData.',
        });
      }

      let buffer: Buffer;
      let detectedMime = mimeType || 'image/jpeg';

      if (typeof fileData === 'string' && fileData.startsWith('data:')) {
        const parts = fileData.split(',');
        const header = parts[0];
        const base64 = parts[1];
        const match = header.match(/data:([^;]+);/);
        if (match) detectedMime = match[1];
        buffer = Buffer.from(base64, 'base64');
      } else if (typeof fileData === 'string') {
        buffer = Buffer.from(fileData, 'base64');
      } else {
        return res.status(400).json({
          success: false,
          error: 'تنسيق الملف غير صالح | Invalid fileData payload format.',
        });
      }

      // Max file size 10MB
      if (buffer.length > 10 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          error: 'حجم الملف يتجاوز الحد المسموح به (10 ميجابايت) | File exceeds 10MB limit.',
        });
      }

      // Validate allowed mime types
      const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
      if (!allowedMimes.includes(detectedMime.toLowerCase())) {
        return res.status(400).json({
          success: false,
          error: 'تنسيق المستند غير مدعوم. يرجى إرفاق صورة (JPG/PNG/WEBP) أو ملف PDF | Unsupported file format. Please upload JPG, PNG, WEBP, or PDF.',
        });
      }

      let ext = '.jpg';
      if (detectedMime.includes('pdf')) ext = '.pdf';
      else if (detectedMime.includes('png')) ext = '.png';
      else if (detectedMime.includes('webp')) ext = '.webp';

      const safeUniqueId = `presc-${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`;
      const targetFilePath = path.join(UPLOADS_DIR, safeUniqueId);

      fs.writeFileSync(targetFilePath, buffer);

      const documentRef = `/api/documents/${safeUniqueId}`;

      return res.json({
        success: true,
        message: 'تم رفع المستند الطبي بنجاح والتحقق من صحته | Prescription uploaded successfully.',
        documentRef,
        filename: safeUniqueId,
        originalName: fileName || safeUniqueId,
        mimeType: detectedMime,
        size: buffer.length,
        uploadedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[Prescription Upload Error]', err);
      return res.status(500).json({
        success: false,
        error: `فشل حفظ الروشتة الطبية: ${err.message}`,
      });
    }
  });

  /**
   * GET /api/documents/:filename
   * Securely serves medical prescription documents with proper headers
   */
  app.get('/api/documents/:filename', (req: Request, res: Response) => {
    try {
      const safeFilename = path.basename(req.params.filename);
      const filePath = path.join(UPLOADS_DIR, safeFilename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).send('Document not found or removed.');
      }

      const stats = fs.statSync(filePath);
      const ext = path.extname(safeFilename).toLowerCase();

      let contentType = 'application/octet-stream';
      if (ext === '.pdf') contentType = 'application/pdf';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.webp') contentType = 'image/webp';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Content-Disposition', 'inline');

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    } catch (err: any) {
      return res.status(500).send('Error serving document');
    }
  });

  // -------------------------------------------------------------
  // Static Brand Logo Asset Management Endpoints
  // -------------------------------------------------------------

  /**
   * GET /api/branding/logos
   * Returns current logo asset metadata from public/logos/ directory
   */
  app.get('/api/branding/logos', (_req: Request, res: Response) => {
    const logosDir = path.resolve(__dirname, 'public/logos');
    try {
      if (!fs.existsSync(logosDir)) {
        fs.mkdirSync(logosDir, { recursive: true });
      }
      const files = fs.readdirSync(logosDir);
      const result = files.map((file) => {
        const stats = fs.statSync(path.join(logosDir, file));
        return {
          filename: file,
          path: `/logos/${file}`,
          size: stats.size,
          updatedAt: stats.mtime.toISOString(),
        };
      });
      return res.json({ success: true, logos: result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/branding/upload-logo
   * Receives logo or favicon file data and saves it as a static project asset in public/assets/branding/ and public/logos/
   */
  app.post('/api/branding/upload-logo', (req: Request, res: Response) => {
    try {
      const { variant, fileData, mimeType, filename: customFilename } = req.body;

      if (!variant || !fileData) {
        return res.status(400).json({
          success: false,
          error: 'بيانات غير مكتملة: يجب تقديم نوع الشعار والملف | Missing variant or fileData',
        });
      }

      const allowedVariants = ['color', 'reversed', 'symbol', 'favicon'];
      if (!allowedVariants.includes(variant)) {
        return res.status(400).json({
          success: false,
          error: 'نوع الشعار غير معروف | Invalid logo variant. Must be color, reversed, symbol, or favicon',
        });
      }

      // Determine extension
      let ext = '.png';
      if (mimeType?.includes('svg') || customFilename?.toLowerCase().endsWith('.svg')) {
        ext = '.svg';
      } else if (mimeType?.includes('png') || customFilename?.toLowerCase().endsWith('.png')) {
        ext = '.png';
      } else if (mimeType?.includes('webp') || customFilename?.toLowerCase().endsWith('.webp')) {
        ext = '.webp';
      } else if (mimeType?.includes('ico') || customFilename?.toLowerCase().endsWith('.ico')) {
        ext = '.ico';
      } else {
        if (typeof fileData === 'string' && fileData.startsWith('data:image/svg+xml')) ext = '.svg';
        else if (typeof fileData === 'string' && fileData.startsWith('data:image/webp')) ext = '.webp';
        else if (typeof fileData === 'string' && fileData.startsWith('data:image/png')) ext = '.png';
      }

      let targetFilename = `ons-logo${ext}`;
      if (variant === 'reversed') {
        targetFilename = `ons-logo-reversed${ext}`;
      } else if (variant === 'symbol') {
        targetFilename = `ons-symbol${ext}`;
      } else if (variant === 'favicon') {
        targetFilename = `favicon${ext}`;
      }

      // Directories
      const brandingDir = path.resolve(__dirname, 'public/assets/branding');
      const logosDir = path.resolve(__dirname, 'public/logos');
      const publicDir = path.resolve(__dirname, 'public');

      if (!fs.existsSync(brandingDir)) fs.mkdirSync(brandingDir, { recursive: true });
      if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir, { recursive: true });

      let buffer: Buffer;
      if (typeof fileData === 'string' && fileData.startsWith('data:')) {
        const base64Data = fileData.split(',')[1];
        buffer = Buffer.from(base64Data, 'base64');
      } else if (typeof fileData === 'string') {
        buffer = fileData.trim().startsWith('<svg') ? Buffer.from(fileData, 'utf-8') : Buffer.from(fileData, 'base64');
      } else {
        return res.status(400).json({
          success: false,
          error: 'تنسيق الملف غير صالح | Invalid file data format',
        });
      }

      // Max 5MB
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          error: 'حجم الملف يتجاوز الحد المسموح به (5 ميجابايت) | File exceeds 5MB limit',
        });
      }

      // 1. Save in public/assets/branding/
      const primaryPath = path.join(brandingDir, targetFilename);
      fs.writeFileSync(primaryPath, buffer);

      // 2. Also save copies for backwards compatibility in public/logos/ and root public if favicon
      if (variant === 'color') {
        fs.writeFileSync(path.join(logosDir, `ons-logo${ext}`), buffer);
      } else if (variant === 'reversed') {
        fs.writeFileSync(path.join(logosDir, `ons-logo-reversed${ext}`), buffer);
      } else if (variant === 'symbol') {
        fs.writeFileSync(path.join(logosDir, `ons-symbol${ext}`), buffer);
        fs.writeFileSync(path.join(brandingDir, `favicon${ext}`), buffer);
      } else if (variant === 'favicon') {
        fs.writeFileSync(path.join(brandingDir, `ons-symbol${ext}`), buffer);
        fs.writeFileSync(path.join(logosDir, `ons-symbol${ext}`), buffer);
        if (ext === '.ico' || ext === '.png') {
          try { fs.writeFileSync(path.join(publicDir, `favicon.ico`), buffer); } catch (_) {}
        }
      }

      // Clean up previous conflicting file extensions
      const altExts = ['.svg', '.png', '.webp', '.ico'].filter((e) => e !== ext);
      for (const altExt of altExts) {
        let oldFilename = `ons-logo${altExt}`;
        if (variant === 'reversed') oldFilename = `ons-logo-reversed${altExt}`;
        else if (variant === 'symbol') oldFilename = `ons-symbol${altExt}`;
        else if (variant === 'favicon') oldFilename = `favicon${altExt}`;

        for (const dir of [brandingDir, logosDir]) {
          const oldPath = path.join(dir, oldFilename);
          if (fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath); } catch (_) {}
          }
        }
      }

      const relativeUrl = `/assets/branding/${targetFilename}`;

      console.log(`[Branding Server] Static branding asset written to disk: ${primaryPath}`);

      return res.json({
        success: true,
        message: `تم حفظ أصل الهوية بنجاح كملف ثابت في مجلد المشروع (${targetFilename}) | Static asset updated in project`,
        filePath: relativeUrl,
        filename: targetFilename,
        updatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[Branding Server Error]', err);
      return res.status(500).json({
        success: false,
        error: `فشل حفظ ملف الهوية في أصول المشروع: ${err.message}`,
      });
    }
  });

  // -------------------------------------------------------------
  // Vite Middleware / Static Asset Mounting
  // -------------------------------------------------------------
  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ONS Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[ONS Server] Fatal error starting server:', err);
  process.exit(1);
});
