import { CustomerRequest, ServiceArea } from '../types';

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
 * Builds standard WhatsApp deep links and handles message dispatch
 */
export function buildWhatsAppLink(phone: string, message: string): string {
  const cleanPhone = formatE164PhoneForWa(phone);
  if (!cleanPhone) return '';
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

/**
 * Generates immediate notification message for the business owner
 */
export function generateOwnerNotificationMessage(order: CustomerRequest, area?: ServiceArea): string {
  const serviceList = order.selectedServices && order.selectedServices.length > 0
    ? order.selectedServices.map(s => s.nameAr).join(' + ')
    : order.serviceNameAr;

  const formattedDate = formatCairoDateDDMMYYYY(order.preferredDate || order.appointmentDate);
  const formattedTime = formatTime12Hour(order.preferredTimeSlot || order.appointmentTime);

  return `🔔 *إشعار طلب رعاية جديد في أُنس (ONS)*
-----------------------------------
📋 *رقم الطلب:* #${order.id}
👤 *العميل / المريض:* ${order.customerName}
📞 *هاتف الاتصال:* ${order.phone}
💬 *رقم الواتساب:* ${order.whatsapp || order.phone}
🩺 *الخدمات المطلوبة:* ${serviceList}
📍 *المنطقة:* ${order.areaNameAr}
🏢 *العنوان:* ${order.addressDetails}
📅 *الموعد المطلوب:* ${formattedDate || 'في أقرب وقت'} (${formattedTime})
💳 *رسوم الانتقال:* ${order.travelFee || 0} ج.م
📝 *ملاحظات:* ${order.notes || 'لا يوجد'}
🔒 *الموافقة على الشروط:* نعم
${order.identityDocumentUrl ? `📎 *مرفق إثبات الهوية:* متوفر ومحفوظ بأمان` : ''}
-----------------------------------
يرجى فتح لوحة التحكم لترشيح أقرب ممارس صحي واعتماد عرض السعر.`;
}

/**
 * Generates unified confirmation message for the customer
 */
export function generateCustomerConfirmationMessage(
  order: CustomerRequest,
  paymentDetails?: { instaPayAddress?: string; vodafoneCashNumber?: string; beneficiaryName?: string } | string
): string {
  const customerName = order.customerName || order.patientName || '';
  const requestRef = order.requestNumber || order.id || '';
  const serviceName = order.serviceNameAr || order.serviceNameEn || 'خدمة تمريضية منزلية';

  const rawDate = order.appointmentDate || order.preferredDate || '';
  const formattedDate = formatCairoDateDDMMYYYY(rawDate);
  const rawTime = order.appointmentTime || order.preferredTimeSlot || '';
  const formattedTime = formatTime12Hour(rawTime);
  const appointmentStr = [formattedDate, formattedTime].filter(Boolean).join(' - ') || 'في أقرب وقت';

  const travelFeeVal = order.estimatedTransportationFee || order.travelFee;
  const travelFeeStr = (typeof travelFeeVal === 'number' && travelFeeVal > 0)
    ? `${travelFeeVal} ج.م`
    : 'تُحدد بعد مراجعة العنوان';

  const greeting = customerName
    ? `أهلًا بحضرتك ${customerName}، مع حضرتك فريق أُنس للرعاية المنزلية 🌿`
    : `أهلًا بحضرتك، مع حضرتك فريق أُنس للرعاية المنزلية 🌿`;

  const paymentLines: string[] = [];
  if (typeof paymentDetails === 'object' && paymentDetails !== null) {
    if (paymentDetails.instaPayAddress) paymentLines.push(`• InstaPay: ${paymentDetails.instaPayAddress}`);
    if (paymentDetails.vodafoneCashNumber) paymentLines.push(`• فودافون كاش: ${paymentDetails.vodafoneCashNumber}`);
    if (paymentDetails.beneficiaryName) paymentLines.push(`• اسم المستفيد: ${paymentDetails.beneficiaryName}`);
  } else if (typeof paymentDetails === 'string' && paymentDetails.trim()) {
    paymentLines.push(paymentDetails.trim());
  }

  const paymentBlock = paymentLines.length > 0
    ? `\n\n${paymentLines.join('\n')}`
    : '';

  return `${greeting}\n\n` +
    `تم استلام طلب الخدمة الخاص بحضرتك بنجاح.\n\n` +
    `بنتواصل مع حضرتك لتأكيد تفاصيل الطلب وموعد الزيارة والتكلفة النهائية للخدمة.\n\n` +
    `الخدمة: ${serviceName}\n` +
    `رقم الطلب: ${requestRef}\n` +
    `موعد الزيارة: ${appointmentStr}\n` +
    `رسوم الانتقال: ${travelFeeStr}\n\n` +
    `يمكن سداد رسوم الانتقال عن طريق وسائل الدفع المتاحة، حسب الطريقة المناسبة لحضرتك وبعد تأكيد تفاصيل الطلب.` +
    `${paymentBlock}\n\n` +
    `بعد مراجعة تفاصيل الطلب، هنأكد لحضرتك التكلفة النهائية للخدمة وموعد الزيارة.\n\n` +
    `شكرًا لثقتك في أُنس ❤️`;
}

