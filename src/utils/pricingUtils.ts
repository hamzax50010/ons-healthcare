/**
 * ONS Healthcare — Centralized Service Request Pricing & Classification Engine
 * 
 * Implements authoritative surcharge rules, timezone handling (Africa/Cairo),
 * Egyptian public holiday checks, and itemized surcharge calculations.
 */

import { Service, ServiceArea, SiteSettings } from '../types';

export interface ApplicableSurcharge {
  code: 'urgent_sameday' | 'latenight' | 'holiday_friday';
  labelAr: string;
  labelEn: string;
  percentage: number;
  amountMin: number;
  amountMax: number;
}

export interface RequestPricingSummary {
  basePriceMin: number;
  basePriceMax: number;
  hasPriceRange: boolean;
  surcharges: ApplicableSurcharge[];
  surchargesTotalMin: number;
  surchargesTotalMax: number;
  transportationFee: number;
  estimatedTotalMin: number;
  estimatedTotalMax: number;
  isStandard: boolean;
  requestClassificationAr: string;
  requestClassificationEn: string;
  isProvisionalPricing: boolean;
  priceNoteAr?: string;
  priceNoteEn?: string;
}

export type PricingCalculationResult = RequestPricingSummary;

// Fixed Egyptian Public Holidays List (Month-Day format) for annual recurrence, plus full date strings for moveable holidays
const EGYPTIAN_STATIC_HOLIDAYS = [
  '01-07', // Coptic Christmas / عيد الميلاد المجيد
  '01-25', // 25 January Revolution / ثورة 25 يناير
  '04-25', // Sinai Liberation Day / عيد تحرير سيناء
  '05-01', // Labour Day / عيد العمال
  '06-30', // 30 June Revolution / ثورة 30 يونيو
  '07-23', // Revolution Day / عيد الثورة
  '10-06', // Armed Forces Day / 6 أكتوبر
];

/**
 * Gets current date string (YYYY-MM-DD) in Cairo timezone (Africa/Cairo)
 */
export function getCairoDateString(dateObj: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(dateObj); // YYYY-MM-DD
  } catch {
    return dateObj.toISOString().split('T')[0];
  }
}

/**
 * Calculates date string (YYYY-MM-DD) and formatted display labels for offset days relative to Cairo time
 */
export function getCairoOffsetDateString(daysOffset: number): { dateStr: string; displayLabelAr: string; displayLabelEn: string; dayNameAr: string; dayNameEn: string } {
  const todayStr = getCairoDateString();
  const [year, month, day] = todayStr.split('-').map(Number);

  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + daysOffset);

  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const monthNamesAr = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  const monthNamesEn = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  const dayNamesAr = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const dayNamesEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const displayLabelAr = `${dd} ${monthNamesAr[d.getUTCMonth()]}`;
  const displayLabelEn = `${monthNamesEn[d.getUTCMonth()]} ${dd}`;
  const dayNameAr = dayNamesAr[d.getUTCDay()];
  const dayNameEn = dayNamesEn[d.getUTCDay()];

  return { dateStr, displayLabelAr, displayLabelEn, dayNameAr, dayNameEn };
}

/**
 * Validates lead time and working hours relative to Africa/Cairo
 */
export function validateAppointmentTimeSlot(dateStr: string, timeStr: string): {
  isValid: boolean;
  warningAr?: string;
  warningEn?: string;
  suggestedTimeStr?: string;
} {
  const todayCairo = getCairoDateString();
  if (!dateStr || dateStr < todayCairo) {
    return {
      isValid: false,
      warningAr: 'التاريخ المحدد يقع في الماضي. يرجى اختيار تاريخ ابتداءً من اليوم.',
      warningEn: 'Selected date is in the past. Please select a date starting today.',
      suggestedTimeStr: '10:00',
    };
  }

  if (dateStr === todayCairo) {
    try {
      const now = new Date();
      const cairoHourStr = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Cairo',
        hour: 'numeric',
        hour12: false,
      }).format(now);
      const currentCairoHour = parseInt(cairoHourStr, 10);
      const selectedHour = parseAppointmentHour(timeStr);

      if (selectedHour <= currentCairoHour) {
        const suggestedHour = currentCairoHour + 2;
        if (suggestedHour >= 22) {
          return {
            isValid: false,
            warningAr: 'انتهت ساعات المواعيد القياسية المتاحة لهذا اليوم. نقترح اختيار موعد غداً ابتداءً من 8:00 صباحاً.',
            warningEn: 'Available standard appointment slots for today have ended. We recommend booking Tomorrow from 8:00 AM.',
            suggestedTimeStr: '09:00',
          };
        }
        const suggestedTimeStr = `${String(suggestedHour).padStart(2, '0')}:00`;
        return {
          isValid: false,
          warningAr: `الوقت المحدد (${timeStr}) قد مضى اليوم أو يتطلب مهلة تنسيق إضافية. أقرب موعد مقترح اليوم هو ${suggestedTimeStr}، أو يمكنك الحجز غداً.`,
          warningEn: `The selected time (${timeStr}) has passed or requires additional notice. Nearest suggested time today is ${suggestedTimeStr}, or you can book Tomorrow.`,
          suggestedTimeStr,
        };
      }
    } catch {
      // fallback
    }
  }

  return { isValid: true };
}

/**
 * Checks if a given date (YYYY-MM-DD) is Friday or Egyptian Public Holiday
 */
export function isFridayOrEgyptianHoliday(dateStr: string): { isHoliday: boolean; reasonAr: string; reasonEn: string } {
  if (!dateStr) return { isHoliday: false, reasonAr: '', reasonEn: '' };

  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = date.getUTCDay(); // 5 = Friday

    if (dayOfWeek === 5) {
      return { isHoliday: true, reasonAr: 'زيارة يوم الجمعة', reasonEn: 'Friday Visit' };
    }

    const monthDay = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (EGYPTIAN_STATIC_HOLIDAYS.includes(monthDay)) {
      return { isHoliday: true, reasonAr: 'عطلة رسمية', reasonEn: 'Public Holiday' };
    }
  } catch {
    // fallback
  }

  return { isHoliday: false, reasonAr: '', reasonEn: '' };
}

/**
 * Parses time string (e.g. "23:00", "10:30 PM", "ليلي", etc.) into hour (0-23)
 */
export function parseAppointmentHour(timeStr?: string): number {
  if (!timeStr) return 12; // default midday
  const trimmed = timeStr.toLowerCase().trim();

  // Try parsing HH:MM
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (match24) {
    let hour = parseInt(match24[1], 10);
    if (trimmed.includes('pm') || trimmed.includes('مساء')) {
      if (hour < 12) hour += 12;
    } else if (trimmed.includes('am') || trimmed.includes('صباح')) {
      if (hour === 12) hour = 0;
    }
    return hour;
  }

  if (trimmed.includes('ليلي') || trimmed.includes('ليل') || trimmed.includes('منتصف الليل') || trimmed.includes('الفجر')) {
    return 23;
  }
  if (trimmed.includes('صباح')) return 9;
  if (trimmed.includes('مساء')) return 18;

  return 12;
}

/**
 * Core Pricing & Surcharge Calculator
 */
export function calculateRequestPricing(
  service: Service | undefined,
  area: ServiceArea | undefined,
  appointmentDateStr: string,
  appointmentTimeStr: string,
  settings?: SiteSettings
): RequestPricingSummary {
  // Base price extraction
  const isApproved =
    service?.isPubliclyPublished === true &&
    (service?.pricingStatus === 'published' || service?.pricingStatus === 'approved') &&
    service?.approvedPriceMin !== undefined &&
    service?.approvedPriceMax !== undefined;

  let basePriceMin = 0;
  let basePriceMax = 0;

  if (service) {
    if (isApproved) {
      basePriceMin = service.approvedPriceMin || 0;
      basePriceMax = service.approvedPriceMax || service.approvedPriceMin || 0;
    } else {
      basePriceMin = service.draftPriceMin || service.basePriceMin || 200;
      basePriceMax = service.draftPriceMax || service.basePriceMax || service.draftPriceMin || 200;
    }
  }

  const hasPriceRange = basePriceMax > basePriceMin;
  const transportationFee = area?.travelFee || 60;

  // Evaluate conditions relative to Cairo timezone
  const todayCairo = getCairoDateString();
  const isSameDay = Boolean(appointmentDateStr && appointmentDateStr === todayCairo);

  const hour = parseAppointmentHour(appointmentTimeStr);
  const isLateNight = hour >= 22 || hour < 8; // After 10:00 PM or before 8:00 AM

  const holidayCheck = isFridayOrEgyptianHoliday(appointmentDateStr);

  const surcharges: ApplicableSurcharge[] = [];

  // 1. Urgent same-day visit: 15% surcharge
  if (isSameDay) {
    const p = 15;
    const minAmt = Math.round((basePriceMin * p) / 100);
    const maxAmt = Math.round((basePriceMax * p) / 100);
    surcharges.push({
      code: 'urgent_sameday',
      labelAr: 'رسوم طلب مستعجل (نفس اليوم) +15%',
      labelEn: 'Urgent Same-Day Surcharge +15%',
      percentage: p,
      amountMin: minAmt,
      amountMax: maxAmt,
    });
  }

  // 2. Late-night visit (after 10:00 PM): 10% surcharge
  if (isLateNight) {
    const p = 10;
    const minAmt = Math.round((basePriceMin * p) / 100);
    const maxAmt = Math.round((basePriceMax * p) / 100);
    surcharges.push({
      code: 'latenight',
      labelAr: 'رسوم خدمة ليلية (بعد 10 مساءً) +10%',
      labelEn: 'Late-Night Surcharge (After 10 PM) +10%',
      percentage: p,
      amountMin: minAmt,
      amountMax: maxAmt,
    });
  }

  // 3. Friday or Public Holiday visit: 30% surcharge
  if (holidayCheck.isHoliday) {
    const p = 30;
    const minAmt = Math.round((basePriceMin * p) / 100);
    const maxAmt = Math.round((basePriceMax * p) / 100);
    surcharges.push({
      code: 'holiday_friday',
      labelAr: `رسوم ${holidayCheck.reasonAr} +30%`,
      labelEn: `Surcharge for ${holidayCheck.reasonEn} +30%`,
      percentage: p,
      amountMin: minAmt,
      amountMax: maxAmt,
    });
  }

  const surchargesTotalMin = surcharges.reduce((sum, s) => sum + s.amountMin, 0);
  const surchargesTotalMax = surcharges.reduce((sum, s) => sum + s.amountMax, 0);

  const estimatedTotalMin = basePriceMin + surchargesTotalMin + transportationFee;
  const estimatedTotalMax = basePriceMax + surchargesTotalMax + transportationFee;

  const isStandard = surcharges.length === 0;

  // Build Arabic & English Classification strings
  let classAr = 'طلب قياسي (مواعيد عمل منتظمة)';
  let classEn = 'Standard Request (Regular Hours)';

  if (!isStandard) {
    const labelsAr = surcharges.map((s) => s.labelAr.split('+')[0].trim());
    const labelsEn = surcharges.map((s) => s.labelEn.split('+')[0].trim());
    classAr = `طلب إضافي (${labelsAr.join(' + ')})`;
    classEn = `Special Request (${labelsEn.join(' + ')})`;
  }

  return {
    basePriceMin,
    basePriceMax,
    hasPriceRange,
    surcharges,
    surchargesTotalMin,
    surchargesTotalMax,
    transportationFee,
    estimatedTotalMin,
    estimatedTotalMax,
    isStandard,
    requestClassificationAr: classAr,
    requestClassificationEn: classEn,
    isProvisionalPricing: !isApproved,
    priceNoteAr: service?.priceNoteAr,
    priceNoteEn: service?.priceNoteEn,
  };
}

/**
 * Normalizes Egyptian phone number into clean international E.164 format (+201xxxxxxxxx)
 */
export function normalizePhoneNumber(rawPhone: string): string {
  if (!rawPhone) return '';
  const digitsOnly = rawPhone.replace(/[^0-9]/g, '');

  if (digitsOnly.startsWith('20') && digitsOnly.length === 12) {
    return `+${digitsOnly}`;
  }
  if (digitsOnly.startsWith('01') && digitsOnly.length === 11) {
    return `+20${digitsOnly.substring(1)}`;
  }
  if (digitsOnly.startsWith('1') && digitsOnly.length === 10) {
    return `+20${digitsOnly}`;
  }
  if (digitsOnly.length >= 8) {
    return `+${digitsOnly}`;
  }
  return rawPhone.trim();
}
