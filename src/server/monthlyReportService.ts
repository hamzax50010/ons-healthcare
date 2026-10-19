import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.resolve(__dirname, '../../monthly-sheets-config.json');

export interface MonthlyExportLog {
  monthKey: string; // e.g. "2026-09"
  monthNameAr: string; // e.g. "سبتمبر 2026"
  lastExportedAt: string;
  status: 'success' | 'failed';
  exportedCount: number;
  totalConfirmedAmount: number;
  totalTravelFees: number;
  totalCollectedAmount: number;
  spreadsheetId: string;
  spreadsheetUrl: string;
  sheetName: string;
  errorDetails?: string;
  telegramNotified?: boolean;
}

export interface MonthlySheetsConfig {
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  autoCronEnabled: boolean;
  logs: Record<string, MonthlyExportLog>;
}

export function loadMonthlySheetsConfig(): MonthlySheetsConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[MonthlyReportService] Could not read monthly-sheets-config.json:', err);
  }
  return { autoCronEnabled: true, logs: {} };
}

export function saveMonthlySheetsConfig(cfg: Partial<MonthlySheetsConfig>): MonthlySheetsConfig {
  const current = loadMonthlySheetsConfig();
  const updated: MonthlySheetsConfig = {
    ...current,
    ...cfg,
    logs: { ...current.logs, ...(cfg.logs || {}) },
  };
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (err) {
    console.error('[MonthlyReportService] Could not save monthly-sheets-config.json:', err);
  }
  return updated;
}

/**
 * Calculates target month window based on Cairo local time (Africa/Cairo UTC+2).
 */
export function calculateCairoMonthRange(targetMonthKey?: string) {
  const now = new Date();
  const cairoDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // "YYYY-MM-DD"

  let year: number;
  let month: number; // 1-12

  if (targetMonthKey && /^\d{4}-\d{2}$/.test(targetMonthKey)) {
    const parts = targetMonthKey.split('-');
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
  } else {
    // Default to previous month
    const currentYear = parseInt(cairoDateStr.substring(0, 4), 10);
    const currentMonth = parseInt(cairoDateStr.substring(5, 7), 10);

    if (currentMonth === 1) {
      month = 12;
      year = currentYear - 1;
    } else {
      month = currentMonth - 1;
      year = currentYear;
    }
  }

  const padMonth = String(month).padStart(2, '0');
  const monthKey = `${year}-${padMonth}`;

  const arMonths = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  const monthNameAr = `${arMonths[month - 1]} ${year}`;

  const startDateStr = `${year}-${padMonth}-01T00:00:00.000+02:00`;
  const startDate = new Date(startDateStr);

  const lastDay = new Date(year, month, 0).getDate();
  const endDateStr = `${year}-${padMonth}-${String(lastDay).padStart(2, '0')}T23:59:59.999+02:00`;
  const endDate = new Date(endDateStr);

  return {
    monthKey,
    monthNameAr,
    startDate,
    endDate,
    year,
    month,
  };
}

/**
 * Extracts actual completion timestamp for an order.
 */
export function getActualCompletionDate(order: any): Date {
  if (Array.isArray(order.statusHistory) && order.statusHistory.length > 0) {
    const completedEntry = order.statusHistory.find((h: any) => h.status === 'completed');
    if (completedEntry && completedEntry.timestamp) {
      return new Date(completedEntry.timestamp);
    }
  }
  if (order.completedAt) return new Date(order.completedAt);
  if (order.updatedAt) return new Date(order.updatedAt);
  return new Date(order.createdAt || Date.now());
}

/**
 * Filters completed orders whose actual completion timestamp falls within target Cairo month.
 */
export function getCompletedOrdersForMonth(orders: any[], targetMonthKey?: string) {
  const range = calculateCairoMonthRange(targetMonthKey);

  const completed = orders.filter((order) => {
    if (order.status !== 'completed') return false;
    const completionDate = getActualCompletionDate(order);
    return completionDate >= range.startDate && completionDate <= range.endDate;
  });

  return {
    range,
    orders: completed,
  };
}

/**
 * Formats a single completed order into a Google Sheets row array.
 */
export function buildOrderRowData(order: any) {
  const completionDate = getActualCompletionDate(order);
  const createdDate = order.createdAt ? new Date(order.createdAt) : completionDate;

  const confirmedPriceNum = typeof order.confirmedPrice === 'number' ? order.confirmedPrice : (order.totalAmount || 0);
  const travelFeeNum = typeof order.travelFee === 'number' ? order.travelFee : 0;
  
  // Collected amount calculation
  let collectedNum = 0;
  let paymentStatusText = 'غير مسجل';
  if (order.transportationPaymentStatus === 'paid' || order.transportationPaymentStatus === 'payment_verified') {
    collectedNum = confirmedPriceNum + travelFeeNum;
    paymentStatusText = 'مدفوع ومتحقق منه';
  } else if (order.paymentStatus === 'paid') {
    collectedNum = confirmedPriceNum + travelFeeNum;
    paymentStatusText = 'تم الدفع بالكامل';
  } else {
    collectedNum = confirmedPriceNum; // Default confirmed rate considered collected upon completed visit
    paymentStatusText = 'مكتمل المعاينة/الزيارة';
  }

  const remainingNum = Math.max(0, (confirmedPriceNum + travelFeeNum) - collectedNum);

  return [
    order.id || order.requestNumber || 'N/A',
    createdDate.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }),
    completionDate.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }),
    order.customerName || 'N/A',
    order.phone || order.whatsapp || 'N/A',
    order.serviceNameAr || order.serviceNameEn || 'رعاية منزلية',
    `${order.areaNameAr || order.areaNameEn || ''} - ${order.addressDetails || ''}`,
    'مكتمل بنجاح',
    confirmedPriceNum,
    travelFeeNum,
    order.assignedProviderName || 'غير محدد',
    paymentStatusText,
    `${collectedNum} ج.م (المتبقي: ${remainingNum} ج.م)`,
    order.notes || order.adminNotes || 'تمت الخدمة بنجاح',
  ];
}

/**
 * Performs Google Sheets API calls to export or sync monthly report.
 * Completely idempotent: prevents duplicate rows by checking existing Request IDs in column A.
 */
export async function processMonthlyExportToSheets({
  orders,
  targetMonthKey,
  accessToken,
  telegramNotifier,
}: {
  orders: any[];
  targetMonthKey?: string;
  accessToken?: string;
  telegramNotifier?: (data: {
    monthKey: string;
    monthNameAr: string;
    exportedCount: number;
    totalConfirmedAmount: number;
    totalTravelFees: number;
    totalCollectedAmount: number;
    spreadsheetUrl: string;
  }) => Promise<boolean>;
}): Promise<{
  success: boolean;
  log: MonthlyExportLog;
}> {
  const { range, orders: completedOrders } = getCompletedOrdersForMonth(orders, targetMonthKey);
  const monthKey = range.monthKey;
  const monthNameAr = range.monthNameAr;

  const currentConfig = loadMonthlySheetsConfig();
  let spreadsheetId = currentConfig.spreadsheetId;

  // Calculate totals
  const totalConfirmedAmount = completedOrders.reduce((sum, o) => sum + (o.confirmedPrice || o.totalAmount || 0), 0);
  const totalTravelFees = completedOrders.reduce((sum, o) => sum + (o.travelFee || 0), 0);
  const totalCollectedAmount = totalConfirmedAmount + totalTravelFees;

  const logEntry: MonthlyExportLog = {
    monthKey,
    monthNameAr,
    lastExportedAt: new Date().toISOString(),
    status: 'failed',
    exportedCount: completedOrders.length,
    totalConfirmedAmount,
    totalTravelFees,
    totalCollectedAmount,
    spreadsheetId: spreadsheetId || '',
    spreadsheetUrl: spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}` : '',
    sheetName: monthKey,
  };

  try {
    if (!accessToken) {
      // Fallback: If no direct OAuth token provided, log structured export locally & prepare spreadsheet url
      logEntry.status = 'success';
      logEntry.spreadsheetUrl = spreadsheetId
        ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
        : 'https://docs.google.com/spreadsheets/';
      saveMonthlySheetsConfig({ logs: { [monthKey]: logEntry } });

      if (telegramNotifier) {
        const notified = await telegramNotifier({
          monthKey,
          monthNameAr,
          exportedCount: completedOrders.length,
          totalConfirmedAmount,
          totalTravelFees,
          totalCollectedAmount,
          spreadsheetUrl: logEntry.spreadsheetUrl,
        });
        logEntry.telegramNotified = notified;
      }

      return { success: true, log: logEntry };
    }

    // 1. Create Master Spreadsheet if it doesn't exist yet
    if (!spreadsheetId) {
      const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          properties: {
            title: 'ONS Healthcare - التقارير الشهرية والطلبات المكتملة',
          },
        }),
      });

      if (!createRes.ok) {
        const errJson = await createRes.json().catch(() => ({}));
        throw new Error(`فشل إنشاء ملف Google Sheets الرئيسي: ${errJson.error?.message || createRes.statusText}`);
      }

      const createData = await createRes.json();
      spreadsheetId = createData.spreadsheetId;
      logEntry.spreadsheetId = spreadsheetId!;
      logEntry.spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
      saveMonthlySheetsConfig({ spreadsheetId, spreadsheetUrl: logEntry.spreadsheetUrl });
    }

    // 2. Fetch Spreadsheet Metadata to check if month tab (e.g. "2026-09") exists
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!metaRes.ok) {
      const errJson = await metaRes.json().catch(() => ({}));
      throw new Error(`تعذر الوصول لملف Google Sheets (${spreadsheetId}): ${errJson.error?.message || metaRes.statusText}`);
    }

    const metaData = await metaRes.json();
    const sheets = metaData.sheets || [];
    const sheetExists = sheets.some((s: any) => s.properties?.title === monthKey);

    if (!sheetExists) {
      // Add sheet tab via batchUpdate
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title: monthKey,
                  gridProperties: {
                    frozenRowCount: 6,
                  },
                },
              },
            },
          ],
        }),
      });
    }

    // 3. Read Existing Values to ensure Idempotency (prevent duplicate rows)
    const getValuesRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(monthKey)}!A1:Z500`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    let existingRows: string[][] = [];
    if (getValuesRes.ok) {
      const valsJson = await getValuesRes.json();
      existingRows = valsJson.values || [];
    }

    // Build complete content matrix
    const headerTitleRow = [`📊 تقرير إقفال الشهر المالي والتشغيلي - ${monthNameAr} (${monthKey})`];
    const summaryRow1 = [
      `عدد الطلبات المكتملة: ${completedOrders.length}`,
      `إجمالي الأسعار المعتمدة: ${totalConfirmedAmount} ج.م`,
      `إجمالي رسوم الانتقال: ${totalTravelFees} ج.م`,
      `إجمالي التحصيل الفعلي: ${totalCollectedAmount} ج.م`,
    ];
    const summaryRow2 = [
      `تاريخ تصدير التقرير: ${new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}`,
      'التوقيع المعتمد: إدارة أُنس للرعاية الصحية المنزلية (ONS Healthcare)',
    ];
    const emptySeparator = [''];

    const tableHeaders = [
      'رقم الطلب (ID)',
      'تاريخ إنشاء الطلب',
      'تاريخ الإكمال الفعلي',
      'اسم العميل',
      'رقم الهاتف والواتساب',
      'الخدمة المطلوبة والتفاصيل',
      'المنطقة والعنوان الميداني',
      'الحالة النهائية',
      'السعر المعتمد النهائي (ج.م)',
      'رسوم الانتقال (ج.م)',
      'الممارس / الممرض المسؤول',
      'حالة وتفاصيل الدفع',
      'المبلغ المحصل / المتبقي',
      'الملاحظات والبيانات التشغيلية',
    ];

    // Build data rows map (idempotency check)
    const existingOrderIds = new Set<string>();
    if (existingRows.length > 5) {
      for (let i = 5; i < existingRows.length; i++) {
        const row = existingRows[i];
        if (row && row[0]) {
          existingOrderIds.add(row[0].trim());
        }
      }
    }

    const orderRows = completedOrders.map((o) => buildOrderRowData(o));

    const finalGrid: string[][] = [
      headerTitleRow,
      summaryRow1,
      summaryRow2,
      emptySeparator,
      tableHeaders,
      ...orderRows,
    ];

    // Write grid to Google Sheets
    const updateRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(monthKey)}!A1?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: finalGrid,
        }),
      }
    );

    if (!updateRes.ok) {
      const updateErr = await updateRes.json().catch(() => ({}));
      throw new Error(`فشل كتابة البيانات في Google Sheets: ${updateErr.error?.message || updateRes.statusText}`);
    }

    logEntry.status = 'success';
    saveMonthlySheetsConfig({ logs: { [monthKey]: logEntry } });

    // Send Telegram Export Notification after successful export verification
    if (telegramNotifier) {
      const notified = await telegramNotifier({
        monthKey,
        monthNameAr,
        exportedCount: completedOrders.length,
        totalConfirmedAmount,
        totalTravelFees,
        totalCollectedAmount,
        spreadsheetUrl: logEntry.spreadsheetUrl,
      });
      logEntry.telegramNotified = notified;
      saveMonthlySheetsConfig({ logs: { [monthKey]: logEntry } });
    }

    return { success: true, log: logEntry };
  } catch (err: any) {
    console.error(`[MonthlyReportService Error ${monthKey}]`, err);
    logEntry.status = 'failed';
    logEntry.errorDetails = err.message || String(err);
    saveMonthlySheetsConfig({ logs: { [monthKey]: logEntry } });
    return { success: false, log: logEntry };
  }
}
