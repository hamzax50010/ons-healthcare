import React, { useState, useEffect } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import {
  CalendarPlus,
  CheckCircle2,
  Clock,
  MapPin,
  ShieldCheck,
  User,
  Phone,
  Home,
  FileText,
  AlertCircle,
  Upload,
  MessageSquare,
  Lock,
  Building,
  Navigation,
  Check,
  X,
  Info,
  Calendar,
  FileCheck,
  DollarSign,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Paperclip,
} from 'lucide-react';
import {
  calculateRequestPricing,
  normalizePhoneNumber,
  getCairoDateString,
  getCairoOffsetDateString,
  validateAppointmentTimeSlot,
  PricingCalculationResult,
  ApplicableSurcharge,
} from '../../utils/pricingUtils';

interface RequestServicePageProps {
  initialServiceId?: string;
  navigate: (route: string, params?: any) => void;
}

export const RequestServicePage: React.FC<RequestServicePageProps> = ({
  initialServiceId,
  navigate,
}) => {
  const { language, t, isRtl } = useLanguage();
  const { services, areas, settings, createCustomerRequest } = useData();

  const BackArrowIcon = isRtl ? ArrowRight : ArrowLeft;

  // Active public services and areas
  const activeServices = services.filter(
    (s) =>
      s &&
      ((s.isPubliclyVisible === true || s.isPubliclyPublished === true) ||
       (s.isPubliclyVisible === undefined && s.isPubliclyPublished === undefined && s.active)) &&
      (s.serviceStatus === undefined || s.serviceStatus === 'active' || s.active)
  );

  const activeAreas = areas.filter((a) => a.active);

  // Check if initialServiceId points to a service in the full services array
  const requestedServiceFromId = initialServiceId
    ? services.find((s) => s.id === initialServiceId)
    : undefined;

  // Default initial service selection
  const defaultInitialId = requestedServiceFromId
    ? requestedServiceFromId.id
    : (activeServices.find((s) => s.id === initialServiceId)?.id || activeServices[0]?.id || '');

  const [selectedServiceId, setSelectedServiceId] = useState<string>(defaultInitialId);

  useEffect(() => {
    if (initialServiceId) {
      const found = services.find((s) => s.id === initialServiceId);
      if (found) {
        setSelectedServiceId(found.id);
      }
    }
  }, [initialServiceId, services]);

  const selectedService = services.find((s) => s.id === selectedServiceId) || activeServices[0];

  // Service availability flags
  const isInitialServiceNotFound = Boolean(initialServiceId && !requestedServiceFromId);
  const isSelectedServiceDisabled = Boolean(
    selectedService &&
    (selectedService.serviceStatus === 'draft' ||
     (selectedService.isPubliclyVisible === false && selectedService.isPubliclyPublished === false))
  );

  // Section A: Location Fields
  const [city, setCity] = useState<string>('القاهرة');
  const [selectedAreaId, setSelectedAreaId] = useState<string>(activeAreas[0]?.id || '');
  const [detailedAddress, setDetailedAddress] = useState<string>('');
  const [nearbyLandmark, setNearbyLandmark] = useState<string>('');

  const selectedArea = activeAreas.find((a) => a.id === selectedAreaId) || activeAreas[0];

  // Section B: Patient Information
  const [patientName, setPatientName] = useState<string>('');
  const [patientAge, setPatientAge] = useState<string>('');
  const [medicalHistory, setMedicalHistory] = useState<string>('');
  const [caseDescription, setCaseDescription] = useState<string>('');

  // Section C: Mandatory Prescription Document Upload
  const [uploadedDocumentRef, setUploadedDocumentRef] = useState<string>('');
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [uploadedFileMime, setUploadedFileMime] = useState<string>('');
  const [uploadedFileSize, setUploadedFileSize] = useState<number>(0);
  const [isUploadingFile, setIsUploadingFile] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Section D: Requested Appointment
  const todayInfo = getCairoOffsetDateString(0);
  const tomorrowInfo = getCairoOffsetDateString(1);
  const dayAfterTomorrowInfo = getCairoOffsetDateString(2);

  const [dateSelectionMode, setDateSelectionMode] = useState<'today' | 'tomorrow' | 'day_after_tomorrow' | 'specific_date'>('today');
  const [appointmentDate, setAppointmentDate] = useState<string>(todayInfo.dateStr);
  const [appointmentTime, setAppointmentTime] = useState<string>('09:00');

  const handleDateModeChange = (mode: 'today' | 'tomorrow' | 'day_after_tomorrow' | 'specific_date') => {
    setDateSelectionMode(mode);
    if (mode === 'today') {
      setAppointmentDate(todayInfo.dateStr);
    } else if (mode === 'tomorrow') {
      setAppointmentDate(tomorrowInfo.dateStr);
    } else if (mode === 'day_after_tomorrow') {
      setAppointmentDate(dayAfterTomorrowInfo.dateStr);
    } else if (mode === 'specific_date') {
      if (!appointmentDate || appointmentDate < todayInfo.dateStr) {
        setAppointmentDate(todayInfo.dateStr);
      }
    }
  };

  // Lead time and time slot validation relative to Africa/Cairo
  const timeValidation = validateAppointmentTimeSlot(appointmentDate, appointmentTime);

  // Section E: Contact Information
  const [customerName, setCustomerName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [isWhatsappSameAsPhone, setIsWhatsappSameAsPhone] = useState<boolean>(true);
  const [whatsapp, setWhatsapp] = useState<string>('');
  const [preferredContactMethod, setPreferredContactMethod] = useState<'whatsapp' | 'phone_call'>('whatsapp');

  // Terms agreement
  const [acceptTerms, setAcceptTerms] = useState<boolean>(true);

  // Form submission state
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formValidationError, setFormValidationError] = useState<string | null>(null);
  const [createdRequestNumber, setCreatedRequestNumber] = useState<string | null>(null);

  // Live Pricing & Classification Calculation
  const pricingSummary: PricingCalculationResult = calculateRequestPricing(
    selectedService,
    selectedArea,
    appointmentDate,
    appointmentTime,
    settings
  );

  // Prescription File Upload Handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);

    // Client-side file size check (10MB)
    if (file.size > 10 * 1024 * 1024) {
      setUploadError(t('حجم الملف يتجاوز الحد المسموح به (10 ميجابايت). يرجى اختيار ملف أصغر.', 'File exceeds 10MB limit. Please choose a smaller file.'));
      return;
    }

    // Client-side MIME check
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type.toLowerCase())) {
      setUploadError(t('تنسيق المستند غير مدعوم. يرجى إرفاق صورة (JPG/PNG/WEBP) أو ملف PDF.', 'Unsupported format. Please upload JPG, PNG, WEBP, or PDF.'));
      return;
    }

    setIsUploadingFile(true);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const fileData = reader.result as string;
        const res = await fetch('/api/prescriptions/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileData,
            fileName: file.name,
            mimeType: file.type,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!data.success) {
          setUploadError(data.error || t('فشل رفع المستند. يرجى المحاولة مرة أخرى.', 'Upload failed. Please try again.'));
        } else {
          setUploadedDocumentRef(data.documentRef);
          setUploadedFileName(file.name);
          setUploadedFileMime(file.type);
          setUploadedFileSize(file.size);
        }
        setIsUploadingFile(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setUploadError(err.message || t('خطأ أثناء رفع المستند.', 'Error uploading document.'));
      setIsUploadingFile(false);
    }
  };

  const handleRemoveUploadedFile = () => {
    setUploadedDocumentRef('');
    setUploadedFileName('');
    setUploadedFileMime('');
    setUploadedFileSize(0);
    setUploadError(null);
  };

  // Form Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormValidationError(null);

    // Validation 1: Requested Service
    if (!selectedService || isInitialServiceNotFound || isSelectedServiceDisabled) {
      setFormValidationError(
        t(
          'الخدمة المطلوبة غير متاحة حالياً. يرجى اختيار خدمة سارية من القائمة.',
          'The requested service is unavailable. Please select a valid service.'
        )
      );
      return;
    }

    // Validation 2: Area
    if (!selectedArea) {
      setFormValidationError(t('يرجى اختيار منطقة الخدمة الجغرافية.', 'Please select a service area.'));
      return;
    }

    // Validation 3: Detailed Address
    if (!detailedAddress.trim()) {
      setFormValidationError(t('يرجى كتابة تفاصيل العنوان واسم الشارع ورقم المبنى.', 'Please enter detailed address information.'));
      return;
    }

    // Validation 4: Patient Info
    if (!patientName.trim()) {
      setFormValidationError(t('يرجى كتابة اسم المريض بالكامل.', 'Please enter patient full name.'));
      return;
    }

    const ageNum = parseInt(patientAge, 10);
    if (isNaN(ageNum) || ageNum <= 0 || ageNum > 120) {
      setFormValidationError(t('يرجى كتابة عمر المريض بشكل صحيح (رقم صحيح).', 'Please enter a valid patient age.'));
      return;
    }

    if (!medicalHistory.trim()) {
      setFormValidationError(t('يرجى توضيح التاريخ الطبي للحالة والأمراض المزمنة أو الأدوية الحالية.', 'Please describe patient medical history.'));
      return;
    }

    // Validation 5: Mandatory Prescription / Medical Document Upload
    if (!uploadedDocumentRef) {
      setFormValidationError(t('إرفاق المستند الطبي أو الروشتة إجباري لتقديم الطلب. يرجى إرفاق الملف قبل المتابعة.', 'Uploading a prescription or medical document is mandatory. Please upload the file to proceed.'));
      return;
    }

    // Validation 6: Appointment Date & Time
    if (!appointmentDate) {
      setFormValidationError(t('يرجى تحديد تاريخ موعد الخدمة المطلوبة.', 'Please select appointment date.'));
      return;
    }

    // Validation 7: Contact Phone
    if (!phone.trim() || phone.replace(/[^0-9]/g, '').length < 8) {
      setFormValidationError(t('يرجى كتابة رقم هاتف اتصال صحيح.', 'Please enter a valid phone number.'));
      return;
    }

    const normalizedPhone = normalizePhoneNumber(phone);
    const effectiveWhatsapp = isWhatsappSameAsPhone ? normalizedPhone : normalizePhoneNumber(whatsapp || phone);

    if (preferredContactMethod === 'whatsapp' && !effectiveWhatsapp) {
      setFormValidationError(t('يرجى كتابة رقم الواتساب للتنسيق.', 'Please enter WhatsApp contact number.'));
      return;
    }

    setIsSubmitting(true);

    try {
      const generatedNumber = `ONS-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

      const requestPayload = {
        requestNumber: generatedNumber,
        serviceId: selectedService.id,
        serviceNameAr: selectedService.nameAr,
        serviceNameEn: selectedService.nameEn,
        selectedServices: [
          {
            serviceId: selectedService.id,
            nameAr: selectedService.nameAr,
            nameEn: selectedService.nameEn,
            price: pricingSummary.basePriceMin,
          },
        ],
        areaId: selectedArea.id,
        areaNameAr: selectedArea.nameAr,
        areaNameEn: selectedArea.nameEn,
        city,
        governorate: city,
        addressDetails: detailedAddress.trim(),
        detailedAddress: detailedAddress.trim(),
        nearbyLandmark: nearbyLandmark.trim(),

        // Patient Info
        patientName: patientName.trim(),
        customerName: customerName.trim() || patientName.trim(),
        patientAge: ageNum,
        medicalHistory: medicalHistory.trim(),
        caseDescription: caseDescription.trim(),

        // Document Reference
        prescriptionDocumentReference: uploadedDocumentRef,
        identityDocumentUrl: uploadedDocumentRef,
        identityDocumentName: uploadedFileName,

        // Appointment
        appointmentDate,
        appointmentTime,
        preferredDate: appointmentDate,
        preferredTimeSlot: appointmentTime,
        appointmentTimezone: 'Africa/Cairo',
        requestClassificationAr: pricingSummary.requestClassificationAr,
        requestClassificationEn: pricingSummary.requestClassificationEn,
        isNightOrUrgent: !pricingSummary.isStandard,

        // Contact
        phone: normalizedPhone,
        whatsapp: effectiveWhatsapp,
        isWhatsappSameAsPhone,
        preferredContactMethod,

        // Pricing Breakdown
        baseServicePriceMin: pricingSummary.basePriceMin,
        baseServicePriceMax: pricingSummary.basePriceMax,
        applicableSurcharges: pricingSummary.surcharges,
        estimatedTransportationFee: pricingSummary.transportationFee,
        travelFee: pricingSummary.transportationFee,
        estimatedTotalMin: pricingSummary.estimatedTotalMin,
        estimatedTotalMax: pricingSummary.estimatedTotalMax,
        isProvisionalPricing: pricingSummary.isProvisionalPricing,
        pricingConfirmationStatus: 'provisional' as const,
        transportationPaymentStatus: 'not_requested' as const,

        termsAccepted: acceptTerms,
        notes: caseDescription.trim(),
      };

      const savedId = await createCustomerRequest(requestPayload);
      setCreatedRequestNumber(generatedNumber || savedId);
    } catch (err: any) {
      setFormValidationError(err.message || t('حدث خطأ أثناء حفظ الطلب. يرجى المحاولة مرة أخرى.', 'Error saving request. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // If request has been submitted successfully, render Customer Confirmation Screen
  if (createdRequestNumber) {
    const ackPhone = normalizePhoneNumber(phone || whatsapp);
    const ackMessage = `أهلًا بحضرتك، معاك فريق أُنس للرعاية المنزلية.\n\nتم استلام طلب الخدمة الخاص بحضرتك بنجاح، ورقم الطلب هو: ${createdRequestNumber}.\n\nفريقنا هيراجع تفاصيل الطلب ومدى توافر الخدمة في الموعد المطلوب، وهيتم التواصل مع حضرتك في أقرب وقت لتأكيد التفاصيل.\n\nبرجاء الاحتفاظ برقم الطلب للمتابعة.\n\nشكرًا لثقتك في أُنس ❤️`;
    const waFollowupUrl = `https://wa.me/201036639814?text=${encodeURIComponent(`مرحباً، أود المتابعة بشأن طلب الخدمة رقم: ${createdRequestNumber}`)}`;

    return (
      <div className="max-w-3xl mx-auto px-4 py-12 sm:py-16">
        <div className="rounded-3xl bg-white border border-[#153B36]/15 shadow-xl p-6 sm:p-10 space-y-8 text-center">
          {/* Header Icon */}
          <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center mx-auto shadow-inner">
            <CheckCircle2 className="w-12 h-12 text-emerald-600" />
          </div>

          <div className="space-y-3">
            <h1 className="text-2xl sm:text-3xl font-black text-[#153B36]">
              {t('تم استلام طلبك بنجاح!', 'Your request has been received!')}
            </h1>
            <div className="inline-block px-4 py-2 rounded-xl bg-[#F5F2EB] border border-[#153B36]/20 font-mono text-lg font-black text-[#153B36]">
              {t('رقم طلبك:', 'Your request number:')} <span className="text-[#153B36]">{createdRequestNumber}</span>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-[#F5F2EB]/80 border border-[#153B36]/10 text-start text-xs sm:text-sm text-[#153B36]/85 space-y-3 leading-relaxed">
            <p className="font-bold text-[#153B36]">
              {t(
                'شكرًا لثقتك في أُنس للرعاية المنزلية. تم استلام طلبك، وسيقوم فريقنا بمراجعته والتواصل معك في أقرب وقت لتأكيد التفاصيل ومدى توافر الخدمة في الموعد المطلوب.',
                'Thank you for choosing ONS Healthcare. Our team will review your request and contact you as soon as possible to confirm the details and service availability.'
              )}
            </p>
            <p>
              {t('يرجى الاحتفاظ برقم الطلب للمتابعة.', 'Please keep your request number for reference.')}
            </p>
            <div className="pt-2 border-t border-[#153B36]/10 text-xs font-semibold text-amber-900 bg-amber-50/80 p-3 rounded-xl">
              ⚠️ {t(
                'ملاحظة: إرسال الطلب لا يعني تأكيد الحجز أو اكتمال الدفع. سيتم تأكيد الموعد والتكلفة النهائية مع فريق أُنس.',
                'Note: Submitting a request does not automatically confirm the appointment or payment. Our team will confirm the appointment and final cost with you.'
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <a
              href={waFollowupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md transition-all"
            >
              <MessageSquare className="w-4 h-4" />
              <span>{t('متابعة الطلب عبر الواتساب', 'Follow Up on WhatsApp')}</span>
            </a>
            <button
              onClick={() => navigate('home')}
              className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-[#153B36] hover:bg-[#0D2622] text-[#F5F2EB] text-xs font-bold flex items-center justify-center gap-2 transition-all"
            >
              <Home className="w-4 h-4" />
              <span>{t('العودة للصفحة الرئيسية', 'Return to Homepage')}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <button
            onClick={() => navigate('services')}
            className="inline-flex items-center gap-2 text-xs font-bold text-[#153B36] hover:text-[#70A69A] transition-colors mb-2"
          >
            <BackArrowIcon className="w-4 h-4" />
            <span>{t('العودة لدليل الخدمات', 'Back to Services Catalog')}</span>
          </button>
          <h1 className="text-2xl sm:text-3xl font-black text-[#153B36]">
            {t('طلب خدمة تمريضية ورعاية منزلية', 'Request Healthcare Service')}
          </h1>
          <p className="text-xs text-[#153B36]/75 mt-1">
            {t(
              'يرجى تعبئة بيانات الطلب والمستند الطبي لتقديم الطلب لفريق التنسيق الطبي بأُنس.',
              'Fill out order details and medical prescription to dispatch ONS care coordination desk.'
            )}
          </p>
        </div>
      </div>

      {/* Validation Error Banner */}
      {formValidationError && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-start gap-3 shadow-xs">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span>{formValidationError}</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Section A: Requested Service & Service Area */}
        <div className="rounded-3xl bg-white border border-[#153B36]/15 p-6 sm:p-8 space-y-6 shadow-xs">
          <h2 className="text-base font-extrabold text-[#153B36] flex items-center gap-2 pb-3 border-b border-[#153B36]/10">
            <CalendarPlus className="w-5 h-5 text-[#70A69A]" />
            <span>{t('أولاً: الخدمة والمنطقة الجغرافية', '1. Requested Service & Coverage Area')}</span>
          </h2>

          {/* Active Pre-Selected Service Callout */}
          {selectedService && !isInitialServiceNotFound && !isSelectedServiceDisabled && (
            <div className="p-4 rounded-2xl bg-[#E7EFEA] border border-[#153B36]/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-xs">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-300">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{t('الخدمة المحددة للطلب', 'Selected Service')}</span>
                  </span>
                  {initialServiceId && (
                    <span className="text-[10px] text-[#153B36]/70 font-bold bg-[#153B36]/10 px-2 py-0.5 rounded-md">
                      ✓ {t('محددة تلقائياً من صفحة تفاصيل الخدمة', 'Pre-selected from service details page')}
                    </span>
                  )}
                </div>
                <h3 className="text-sm sm:text-base font-extrabold text-[#153B36]">
                  {language === 'ar' ? selectedService.nameAr : selectedService.nameEn}
                </h3>
                {(selectedService.summaryAr || selectedService.summaryEn) && (
                  <p className="text-xs text-[#153B36]/75 line-clamp-2">
                    {language === 'ar'
                      ? (selectedService.summaryAr || selectedService.summaryEn)
                      : (selectedService.summaryEn || selectedService.summaryAr)}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-start sm:text-end bg-white/80 p-2.5 rounded-xl border border-[#153B36]/10">
                <span className="text-[10px] uppercase font-bold text-[#153B36]/60 block">
                  {t('سعر الخدمة', 'Service Rate')}
                </span>
                <span className="font-extrabold text-xs text-[#153B36]">
                  {t('السعر يحدد بعد الطلب', 'Price determined after order')}
                </span>
              </div>
            </div>
          )}

          {/* Missing or Unavailable Service Alert */}
          {(isInitialServiceNotFound || isSelectedServiceDisabled || !selectedService) && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-bold flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-extrabold text-sm text-amber-900">
                  {t('الخدمة المطلوبة غير متاحة حالياً', 'Requested Service Unavailable')}
                </p>
                <p className="text-xs text-amber-800 font-normal">
                  {t(
                    'عذراً، الخدمة المعيّنة في الرابط غير متاحة للطلب حالياً أو تم تعديل حالتها. يرجى اختيار خدمة أخرى سارية من القائمة أدناه.',
                    'Sorry, the requested service in the link is not currently available for booking. Please select another valid service from the dropdown below.'
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
            {/* Service selector */}
            <div>
              <label className="block font-bold text-[#153B36] mb-1.5">
                {t('الخدمة الطبية / التمريضية المطلوبة *', 'Requested Medical Service *')}
              </label>
              <select
                value={selectedServiceId}
                onChange={(e) => setSelectedServiceId(e.target.value)}
                className="w-full bg-[#F5F2EB]/60 border border-[#153B36]/20 rounded-xl px-3.5 py-2.5 text-xs font-bold text-[#153B36] focus:outline-hidden focus:border-[#153B36]"
              >
                {activeServices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {language === 'ar' ? s.nameAr : s.nameEn}
                  </option>
                ))}
              </select>
            </div>

            {/* City / Governorate */}
            <div>
              <label className="block font-bold text-[#153B36] mb-1.5">
                {t('المحافظة / المدينة *', 'Governorate / City *')}
              </label>
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full bg-[#F5F2EB]/60 border border-[#153B36]/20 rounded-xl px-3.5 py-2.5 text-xs font-bold text-[#153B36] focus:outline-hidden focus:border-[#153B36]"
              >
                <option value="القاهرة">{t('القاهرة', 'Cairo')}</option>
                <option value="الجيزة">{t('الجيزة', 'Giza')}</option>
              </select>
            </div>

            {/* Geographic Area */}
            <div>
              <label className="block font-bold text-[#153B36] mb-1.5">
                {t('منطقة التغطية الجغرافية *', 'Geographic Coverage Area *')}
              </label>
              <select
                value={selectedAreaId}
                onChange={(e) => setSelectedAreaId(e.target.value)}
                className="w-full bg-[#F5F2EB]/60 border border-[#153B36]/20 rounded-xl px-3.5 py-2.5 text-xs font-bold text-[#153B36] focus:outline-hidden focus:border-[#153B36]"
              >
                {activeAreas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {language === 'ar' ? a.nameAr : a.nameEn} ({a.travelFee} {settings.currency || 'ج.م'} انتقال)
                  </option>
                ))}
              </select>
            </div>

            {/* Nearby Landmark */}
            <div>
              <label className="block font-bold text-[#153B36] mb-1.5">
                {t('أقرب علامة مميزة (مستشفى، مسجد، ميدان) - مستحسن', 'Nearby Landmark (Recommended)')}
              </label>
              <input
                type="text"
                placeholder={t('مثال: بجوار مستشفى الشروق أو محطة المترو', 'e.g. Near Metro Station')}
                value={nearbyLandmark}
                onChange={(e) => setNearbyLandmark(e.target.value)}
                className="w-full bg-[#F5F2EB]/60 border border-[#153B36]/20 rounded-xl px-3.5 py-2.5 text-xs text-[#153B36] focus:outline-hidden focus:border-[#153B36]"
              />
            </div>
          </div>

          {/* Detailed Address */}
          <div>
            <label className="block font-bold text-[#153B36] text-xs mb-1.5">
              {t('العنوان بالتفصيل (اسم الشارع، رقم المبنى، الطابق، رقم الشقة) *', 'Detailed Address (Street, Building, Floor, Flat) *')}
            </label>
            <textarea
              rows={2}
              required
              placeholder={t('مثال: شارع مصطفى النحاس، عمارة 14، الدور الثالث، شقة 6', 'e.g. 14 Mostafa El Nahas St, Building 14, 3rd Floor, Flat 6')}
              value={detailedAddress}
              onChange={(e) => setDetailedAddress(e.target.value)}
              className="w-full bg-[#F5F2EB]/60 border border-[#153B36]/20 rounded-xl px-3.5 py-2.5 text-xs text-[#153B36] focus:outline-hidden focus:border-[#153B36]"
            />
          </div>
        </div>

        {/* Section B: Patient Information */}
        <div className="rounded-3xl bg-white border border-[#153B36]/15 p-6 sm:p-8 space-y-6 shadow-xs">
          <h2 className="text-base font-extrabold text-[#153B36] flex items-center gap-2 pb-3 border-b border-[#153B36]/10">
            <User className="w-5 h-5 text-[#70A69A]" />
            <span>{t('ثانياً: بيانات المريض والتاريخ الطبي', '2. Patient Information & Medical History')}</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs">
            {/* Patient Name */}
            <div>
              <label className="block font-bold text-[#153B36] mb-1.5">
                {t('اسم المريض بالكامل *', 'Patient Full Name *')}
              </label>
              <input
                type="text"
                required
                placeholder={t('مثال: محمد أحمد علي', 'e.g. Mohamed Ahmed')}
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                className="w-full bg-[#F5F2EB]/60 border border-[#153B36]/20 rounded-xl px-3.5 py-2.5 text-xs text-[#153B36] focus:outline-hidden focus:border-[#153B36]"
              />
            </div>

            {/* Patient Age */}
            <div>
              <label className="block font-bold text-[#153B36] mb-1.5">
                {t('عمر المريض (بالسنوات) *', 'Patient Age (Years) *')}
              </label>
              <input
                type="number"
                required
                min={1}
                max={120}
                placeholder={t('مثال: 65', 'e.g. 65')}
                value={patientAge}
                onChange={(e) => setPatientAge(e.target.value)}
                className="w-full bg-[#F5F2EB]/60 border border-[#153B36]/20 rounded-xl px-3.5 py-2.5 text-xs font-bold text-[#153B36] focus:outline-hidden focus:border-[#153B36]"
              />
            </div>
          </div>

          {/* Medical History */}
          <div>
            <label className="block font-bold text-[#153B36] text-xs mb-1.5">
              {t('التاريخ الطبي والحالة الصحية (الأمراض المزمنة، الحساسية، الأدوية الحالية) *', 'Medical History (Chronic Conditions, Allergies, Current Medications) *')}
            </label>
            <textarea
              rows={3}
              required
              placeholder={t('مثال: مريض ضغط وسكر، يجري غسيل كلوي يوم بعد يوم، يتناول أدوية سيولة...', 'e.g. Diabetes, hypertension, currently on blood thinners...')}
              value={medicalHistory}
              onChange={(e) => setMedicalHistory(e.target.value)}
              className="w-full bg-[#F5F2EB]/60 border border-[#153B36]/20 rounded-xl px-3.5 py-2.5 text-xs text-[#153B36] focus:outline-hidden focus:border-[#153B36]"
            />
          </div>

          {/* Case Description & Additional Notes */}
          <div>
            <label className="block font-bold text-[#153B36] text-xs mb-1.5">
              {t('وصف الحالة وملاحظات إضافية لفريق التمريض', 'Case Description & Additional Notes')}
            </label>
            <textarea
              rows={2}
              placeholder={t('أي تفاصيل إضافية تحب إبلاغها للتمريض قبل الزيارة...', 'Any additional instructions for the nursing team...')}
              value={caseDescription}
              onChange={(e) => setCaseDescription(e.target.value)}
              className="w-full bg-[#F5F2EB]/60 border border-[#153B36]/20 rounded-xl px-3.5 py-2.5 text-xs text-[#153B36] focus:outline-hidden focus:border-[#153B36]"
            />
          </div>

          {/* Privacy Notice */}
          <div className="p-3.5 rounded-2xl bg-[#E7EFEA]/80 border border-[#153B36]/15 flex items-start gap-2.5 text-xs text-[#153B36]">
            <ShieldCheck className="w-5 h-5 text-[#70A69A] shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              {t(
                'إشعار الخصوصية الطبية: المعلومات الطبية والمستندات المرفقة تُستخدم حصريًا لتقييم الحالة وتنسيق تقديم الخدمة التمريضية المناسبة وفق أعلى معايير الخصوصية والسرية.',
                'Medical Privacy Notice: Medical information and uploaded documents are used exclusively to assess and coordinate nursing care under strict privacy.'
              )}
            </p>
          </div>
        </div>

        {/* Section C: Mandatory Prescription Upload */}
        <div className="rounded-3xl bg-white border border-[#153B36]/15 p-6 sm:p-8 space-y-6 shadow-xs">
          <h2 className="text-base font-extrabold text-[#153B36] flex items-center gap-2 pb-3 border-b border-[#153B36]/10">
            <Paperclip className="w-5 h-5 text-[#70A69A]" />
            <span>{t('ثالثاً: إرفاق الروشتة أو المستند الطبي (إجباري) *', '3. Prescription / Medical Document Upload (Mandatory) *')}</span>
          </h2>

          <p className="text-xs text-[#153B36]/75">
            {t(
              'يشترط تقديم روشتة طبيب معتمدة أو تقرير طبي لإجراء الخدمات التمريضية والإجراءات العلاجية. يرجى التقاط صورة واضحة للروشتة أو إرفاق ملف PDF.',
              'Uploading a doctor prescription or medical report is mandatory for clinical care procedures. Please capture a clear image or attach PDF.'
            )}
          </p>

          {uploadError && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center justify-between gap-2">
              <span>{uploadError}</span>
              <button onClick={() => setUploadError(null)} className="p-1 hover:opacity-75">
                <X className="w-4 h-4 text-rose-600" />
              </button>
            </div>
          )}

          {!uploadedDocumentRef ? (
            <div className="border-2 border-dashed border-[#153B36]/20 hover:border-[#153B36] rounded-2xl p-6 sm:p-8 text-center bg-[#F5F2EB]/40 transition-colors">
              <input
                type="file"
                id="prescriptionUploadInput"
                accept="image/jpeg,image/jpg,image/png,image/webp,application/pdf"
                onChange={handleFileUpload}
                disabled={isUploadingFile}
                className="hidden"
              />
              <label
                htmlFor="prescriptionUploadInput"
                className="cursor-pointer space-y-3 flex flex-col items-center justify-center"
              >
                <div className="w-12 h-12 rounded-full bg-[#153B36]/10 text-[#153B36] flex items-center justify-center">
                  <Upload className="w-6 h-6 text-[#70A69A]" />
                </div>
                <div>
                  <span className="text-xs font-extrabold text-[#153B36] block">
                    {isUploadingFile
                      ? t('جاري رفع المستند والتحقق منه...', 'Uploading document...')
                      : t('انقر هنا لاختيار صورة الروشتة أو ملف التقرير الطبي', 'Click to upload prescription image or PDF report')}
                  </span>
                  <span className="text-[11px] text-[#153B36]/60 mt-1 block">
                    {t('الصيغ المدعومة: PNG, JPG, WEBP, PDF (بحد أقصى 10 ميجابايت)', 'Supported formats: PNG, JPG, WEBP, PDF (Max 10MB)')}
                  </span>
                </div>
              </label>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <FileCheck className="w-6 h-6 text-emerald-600 shrink-0" />
                <div className="text-xs">
                  <span className="font-extrabold text-emerald-900 block">{uploadedFileName}</span>
                  <span className="text-[11px] text-emerald-700">
                    {t('تم الرفع بنجاح', 'Uploaded successfully')} ({(uploadedFileSize / 1024).toFixed(1)} KB)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={uploadedDocumentRef}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-emerald-800 text-white text-[11px] font-bold hover:bg-emerald-900"
                >
                  {t('معاينة', 'Preview')}
                </a>
                <button
                  type="button"
                  onClick={handleRemoveUploadedFile}
                  className="p-1.5 rounded-lg text-rose-700 hover:bg-rose-100"
                  title={t('استبدال الملف', 'Replace file')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Section D: Requested Appointment & Pricing Calculation */}
        <div className="rounded-3xl bg-white border border-[#153B36]/15 p-6 sm:p-8 space-y-6 shadow-xs">
          <h2 className="text-base font-extrabold text-[#153B36] flex items-center gap-2 pb-3 border-b border-[#153B36]/10">
            <Clock className="w-5 h-5 text-[#70A69A]" />
            <span>{t('رابعاً: موعد الخدمة وحساب التكلفة التقديرية', '4. Requested Appointment & Estimated Pricing')}</span>
          </h2>

          {/* Standard Service Hours Banner */}
          <div className="p-3.5 rounded-2xl bg-[#F5F2EB] border border-[#153B36]/10 text-xs text-[#153B36] flex items-center gap-2 font-semibold">
            <Info className="w-4 h-4 text-[#70A69A] shrink-0" />
            <span>
              {t(
                'ساعات العمل القياسية من 8:00 صباحًا حتى 10:00 مساءً. الزيارات العاجلة أو الليلية أو أيام الجمعة تخضع لرسوم إضافية وسيريتها فريق التنسيق.',
                'Standard service hours are 8:00 AM to 10:00 PM. Same-day, late-night, or Friday visits carry surcharges confirmed by desk.'
              )}
            </span>
          </div>

            {/* 1. Date Selection UI (4 Quick Cards/Buttons) */}
            <div className="space-y-3">
              <label className="block font-bold text-xs text-[#153B36]">
                {t('حدد تاريخ الزيارة المطلوبة *', 'Select Visit Date *')}
              </label>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {/* Option 1: Today */}
                <button
                  type="button"
                  onClick={() => handleDateModeChange('today')}
                  className={`p-3.5 rounded-2xl border text-start flex flex-col justify-between gap-2 transition-all relative overflow-hidden active:scale-98 ${
                    dateSelectionMode === 'today'
                      ? 'bg-[#153B36] text-[#F5F2EB] border-[#153B36] shadow-md ring-2 ring-[#70A69A]/40'
                      : 'bg-[#F5F2EB]/60 text-[#153B36] border-[#153B36]/15 hover:border-[#153B36]/40 hover:bg-[#E7EFEA]/80'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-extrabold text-xs sm:text-sm">
                      {t('اليوم', 'Today')}
                    </span>
                    {dateSelectionMode === 'today' && (
                      <CheckCircle2 className="w-4 h-4 text-[#70A69A]" />
                    )}
                  </div>
                  <span className={`text-[11px] font-bold ${dateSelectionMode === 'today' ? 'text-[#70A69A]' : 'text-[#153B36]/70'}`}>
                    {language === 'ar' ? todayInfo.displayLabelAr : todayInfo.displayLabelEn}
                  </span>
                </button>

                {/* Option 2: Tomorrow */}
                <button
                  type="button"
                  onClick={() => handleDateModeChange('tomorrow')}
                  className={`p-3.5 rounded-2xl border text-start flex flex-col justify-between gap-2 transition-all relative overflow-hidden active:scale-98 ${
                    dateSelectionMode === 'tomorrow'
                      ? 'bg-[#153B36] text-[#F5F2EB] border-[#153B36] shadow-md ring-2 ring-[#70A69A]/40'
                      : 'bg-[#F5F2EB]/60 text-[#153B36] border-[#153B36]/15 hover:border-[#153B36]/40 hover:bg-[#E7EFEA]/80'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-extrabold text-xs sm:text-sm">
                      {t('غداً', 'Tomorrow')}
                    </span>
                    {dateSelectionMode === 'tomorrow' && (
                      <CheckCircle2 className="w-4 h-4 text-[#70A69A]" />
                    )}
                  </div>
                  <span className={`text-[11px] font-bold ${dateSelectionMode === 'tomorrow' ? 'text-[#70A69A]' : 'text-[#153B36]/70'}`}>
                    {language === 'ar' ? tomorrowInfo.displayLabelAr : tomorrowInfo.displayLabelEn}
                  </span>
                </button>

                {/* Option 3: Day After Tomorrow */}
                <button
                  type="button"
                  onClick={() => handleDateModeChange('day_after_tomorrow')}
                  className={`p-3.5 rounded-2xl border text-start flex flex-col justify-between gap-2 transition-all relative overflow-hidden active:scale-98 ${
                    dateSelectionMode === 'day_after_tomorrow'
                      ? 'bg-[#153B36] text-[#F5F2EB] border-[#153B36] shadow-md ring-2 ring-[#70A69A]/40'
                      : 'bg-[#F5F2EB]/60 text-[#153B36] border-[#153B36]/15 hover:border-[#153B36]/40 hover:bg-[#E7EFEA]/80'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-extrabold text-xs sm:text-sm">
                      {t('بعد غد', 'Day After')}
                    </span>
                    {dateSelectionMode === 'day_after_tomorrow' && (
                      <CheckCircle2 className="w-4 h-4 text-[#70A69A]" />
                    )}
                  </div>
                  <span className={`text-[11px] font-bold ${dateSelectionMode === 'day_after_tomorrow' ? 'text-[#70A69A]' : 'text-[#153B36]/70'}`}>
                    {language === 'ar' ? dayAfterTomorrowInfo.displayLabelAr : dayAfterTomorrowInfo.displayLabelEn}
                  </span>
                </button>

                {/* Option 4: Specific Date */}
                <button
                  type="button"
                  onClick={() => handleDateModeChange('specific_date')}
                  className={`p-3.5 rounded-2xl border text-start flex flex-col justify-between gap-2 transition-all relative overflow-hidden active:scale-98 ${
                    dateSelectionMode === 'specific_date'
                      ? 'bg-[#153B36] text-[#F5F2EB] border-[#153B36] shadow-md ring-2 ring-[#70A69A]/40'
                      : 'bg-[#F5F2EB]/60 text-[#153B36] border-[#153B36]/15 hover:border-[#153B36]/40 hover:bg-[#E7EFEA]/80'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-extrabold text-xs sm:text-sm">
                      {t('موعد محدد', 'Choose Date')}
                    </span>
                    {dateSelectionMode === 'specific_date' && (
                      <CheckCircle2 className="w-4 h-4 text-[#70A69A]" />
                    )}
                  </div>
                  <span className={`text-[11px] font-bold ${dateSelectionMode === 'specific_date' ? 'text-[#70A69A]' : 'text-[#153B36]/70'}`}>
                    {dateSelectionMode === 'specific_date' && appointmentDate ? appointmentDate : t('اختر تاريخ آخر', 'Pick a Date')}
                  </span>
                </button>
              </div>

              {/* Date Picker Input when "Specific Date" is selected */}
              {dateSelectionMode === 'specific_date' && (
                <div className="p-4 rounded-2xl bg-[#E7EFEA]/80 border border-[#70A69A]/30 space-y-2 mt-3">
                  <label className="block font-bold text-xs text-[#153B36]">
                    {t('اختر التاريخ المحدد من التقويم *', 'Select Specific Date from Calendar *')}
                  </label>
                  <input
                    type="date"
                    required
                    min={todayInfo.dateStr}
                    value={appointmentDate}
                    onChange={(e) => setAppointmentDate(e.target.value)}
                    className="w-full bg-white border border-[#153B36]/20 rounded-xl px-3.5 py-2.5 text-xs font-bold text-[#153B36] focus:outline-hidden focus:border-[#153B36]"
                  />
                  <p className="text-[11px] font-semibold text-[#153B36]/70">
                    📅 {t('التاريخ المحدد حالياً:', 'Currently selected date:')} <strong className="text-[#153B36]">{appointmentDate}</strong>
                  </p>
                </div>
              )}
            </div>

            {/* 2. Time Slot Selection */}
            <div className="space-y-3 pt-2">
              <label className="block font-bold text-xs text-[#153B36]">
                {t('اختر وقت الزيارة المطلوب *', 'Select Visit Time Slot *')}
              </label>
              <select
                value={appointmentTime}
                onChange={(e) => setAppointmentTime(e.target.value)}
                className="w-full bg-[#F5F2EB]/60 border border-[#153B36]/20 rounded-xl px-3.5 py-2.5 text-xs font-bold text-[#153B36] focus:outline-hidden focus:border-[#153B36]"
              >
                <option value="09:00">09:00 AM ({t('صباحاً - موعد قياسي', '09:00 AM - Morning')})</option>
                <option value="12:00">12:00 PM ({t('ظهراً - موعد قياسي', '12:00 PM - Noon')})</option>
                <option value="15:00">03:00 PM ({t('عصراً - موعد قياسي', '03:00 PM - Afternoon')})</option>
                <option value="18:00">06:00 PM ({t('مساءً - موعد قياسي', '06:00 PM - Evening')})</option>
                <option value="21:00">09:00 PM ({t('مساءً - موعد قياسي', '09:00 PM - Night')})</option>
                <option value="22:00">10:00 PM ({t('10 مساءً - بداية الفترة الليلية +10%', '10:00 PM - Late Night +10%')})</option>
                <option value="23:00">11:00 PM ({t('11 مساءً - فترة ليلية +10%', '11:00 PM - Late Night +10%')})</option>
              </select>

              {/* Time slot lead-time & Working hours warning if applicable */}
              {!timeValidation.isValid && (
                <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold flex items-start gap-2.5 shadow-xs">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-extrabold text-[#153B36]">
                      {t('تنبيه بشأن الموعد المختار:', 'Schedule Slot Notice:')}
                    </p>
                    <p className="text-amber-900 leading-relaxed">
                      {language === 'ar' ? timeValidation.warningAr : timeValidation.warningEn}
                    </p>
                    {timeValidation.suggestedTimeStr && (
                      <button
                        type="button"
                        onClick={() => setAppointmentTime(timeValidation.suggestedTimeStr!)}
                        className="mt-1 px-3 py-1.5 rounded-xl bg-[#153B36] text-[#F5F2EB] text-[11px] font-bold hover:bg-[#0D2622] transition-colors inline-flex items-center gap-1.5"
                      >
                        <Clock className="w-3.5 h-3.5 text-[#70A69A]" />
                        <span>
                          {t(
                            `اعتماد الموعد المتاح المقترح (${timeValidation.suggestedTimeStr})`,
                            `Adopt suggested available time (${timeValidation.suggestedTimeStr})`
                          )}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Confirmation disclaimer notice */}
              <div className="p-3 rounded-2xl bg-[#E7EFEA]/80 border border-[#70A69A]/30 text-[11px] text-[#153B36] flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#153B36] shrink-0" />
                <p className="leading-relaxed">
                  {t(
                    'ملاحظة تنظيمية: الموعد المحدد يُسجل كأولوية مفضلة لديك، وسيتم تأكيد الموعد النهائي والتنسيق الهاتفي مع فريق أُنس للرعاية قبل تحرك التمريض.',
                    'Notice: Selected date & time is stored as your preferred appointment slot, and will be confirmed by phone with ONS care desk prior to nurse dispatch.'
                  )}
                </p>
              </div>
            </div>

          {/* Pricing & Surcharges Live Breakdown Box */}
          <div className="p-5 rounded-2xl bg-[#F5F2EB]/70 border border-[#153B36]/15 space-y-4">
            <h3 className="text-xs font-extrabold text-[#153B36] flex items-center justify-between border-b border-[#153B36]/10 pb-2">
              <span className="flex items-center gap-1.5">
                <DollarSign className="w-4 h-4 text-[#70A69A]" />
                <span>{t('بيان التكلفة والتسعير التقديري للطلب', 'Itemized Cost & Surcharges Summary')}</span>
              </span>
              <span className="text-[10px] font-bold text-[#153B36]/70 uppercase tracking-wider">
                {pricingSummary.requestClassificationAr}
              </span>
            </h3>

            <div className="space-y-2 text-xs text-[#153B36]/85">
              {/* Base price */}
              <div className="flex justify-between items-center">
                <span>{t('سعر الخدمة الأساسي:', 'Base Service Price:')}</span>
                <span className="font-semibold text-[#153B36]">
                  {t('السعر يحدد بعد الطلب', 'Price determined after order')}
                </span>
              </div>

              {/* Transportation fee */}
              <div className="flex justify-between items-center">
                <span>{t('رسوم الانتقال والجغرافيا (حسب المنطقة):', 'Area Transportation Fee:')}</span>
                <span className="font-mono font-bold text-[#153B36]">{pricingSummary.transportationFee} {settings.currency || 'ج.م'}</span>
              </div>

              {/* Surcharges (Displays name & percentage without disclosing calculated EGP amount) */}
              {pricingSummary.surcharges.map((s: ApplicableSurcharge, idx: number) => (
                <div key={idx} className="flex justify-between items-center text-amber-900 font-semibold bg-amber-50/80 px-2.5 py-1 rounded-lg">
                  <span>• {language === 'ar' ? s.labelAr : s.labelEn}</span>
                  <span className="font-mono font-bold">+{s.percentage}%</span>
                </div>
              ))}

              {/* Total Estimated */}
              <div className="pt-3 border-t border-[#153B36]/15 flex justify-between items-center text-sm font-extrabold text-[#153B36]">
                <span>{t('رسوم الانتقال المعلنة:', 'Declared Transportation Fee:')}</span>
                <span className="font-mono text-base text-[#153B36]">
                  {pricingSummary.transportationFee} {settings.currency || 'ج.م'}
                </span>
              </div>
            </div>

            {/* Required Customer-Facing Pricing Notice */}
            <p className="text-[11px] text-[#153B36]/80 font-semibold leading-relaxed pt-2 border-t border-[#153B36]/10">
              {language === 'ar'
                ? 'السعر يحدد بعد الطلب. بعد إرسال طلبك، سيتواصل معك فريق أُنس لتأكيد سعر الخدمة والتكلفة النهائية'
                : 'Price determined after order. After submitting your request, the ONS team will contact you to confirm the service price and final cost.'}
            </p>
          </div>
        </div>

        {/* Section E: Contact Information & Transportation Notice */}
        <div className="rounded-3xl bg-white border border-[#153B36]/15 p-6 sm:p-8 space-y-6 shadow-xs">
          <h2 className="text-base font-extrabold text-[#153B36] flex items-center gap-2 pb-3 border-b border-[#153B36]/10">
            <Phone className="w-5 h-5 text-[#70A69A]" />
            <span>{t('خامساً: بيانات الاتصال والتواصل', '5. Contact Information & Communication Desk')}</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs">
            {/* Preferred Contact Method */}
            <div>
              <label className="block font-bold text-[#153B36] mb-1.5">
                {t('وسيلة التواصل المفضلة *', 'Preferred Contact Method *')}
              </label>
              <select
                value={preferredContactMethod}
                onChange={(e) => setPreferredContactMethod(e.target.value as 'whatsapp' | 'phone_call')}
                className="w-full bg-[#F5F2EB]/60 border border-[#153B36]/20 rounded-xl px-3.5 py-2.5 text-xs font-bold text-[#153B36] focus:outline-hidden focus:border-[#153B36]"
              >
                <option value="whatsapp">💬 {t('مراسلة عبر الواتساب (WhatsApp)', 'WhatsApp Message')}</option>
                <option value="phone_call">📞 {t('اتصال تليفوني مباشر (Phone Call)', 'Direct Phone Call')}</option>
              </select>
            </div>

            {/* Phone Number */}
            <div>
              <label className="block font-bold text-[#153B36] mb-1.5">
                {t('رقم هاتف الاتصال المباشر *', 'Direct Phone Number *')}
              </label>
              <input
                type="tel"
                required
                dir="ltr"
                placeholder={t('مثال: 01012345678', 'e.g. 01012345678')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-[#F5F2EB]/60 border border-[#153B36]/20 rounded-xl px-3.5 py-2.5 text-xs font-mono font-bold text-[#153B36] focus:outline-hidden focus:border-[#153B36]"
              />
            </div>
          </div>

          {/* WhatsApp Same as Phone Checkbox */}
          <div className="space-y-3 text-xs">
            <label className="flex items-center gap-2 cursor-pointer font-bold text-[#153B36]">
              <input
                type="checkbox"
                checked={isWhatsappSameAsPhone}
                onChange={(e) => setIsWhatsappSameAsPhone(e.target.checked)}
                className="w-4 h-4 rounded-md accent-[#153B36]"
              />
              <span>{t('رقم الواتساب للتنسيق هو نفس رقم الهاتف المكتوب أعلاه', 'WhatsApp number is the same as the phone number above')}</span>
            </label>

            {!isWhatsappSameAsPhone && (
              <div>
                <label className="block font-bold text-[#153B36] mb-1.5">
                  {t('رقم الواتساب للتنسيق *', 'WhatsApp Coordination Number *')}
                </label>
                <input
                  type="tel"
                  required
                  dir="ltr"
                  placeholder={t('مثال: 01012345678', 'e.g. 01012345678')}
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  className="w-full bg-[#F5F2EB]/60 border border-[#153B36]/20 rounded-xl px-3.5 py-2.5 text-xs font-mono font-bold text-[#153B36] focus:outline-hidden focus:border-[#153B36]"
                />
              </div>
            )}
          </div>

          {/* Required Transportation Payment Notice */}
          <div className="p-4 rounded-2xl bg-sky-50 border border-sky-200 text-xs text-sky-950 space-y-1.5">
            <h4 className="font-extrabold flex items-center gap-1.5 text-sky-900">
              <Info className="w-4 h-4 text-sky-700 shrink-0" />
              <span>{t('تنويه هام بخصوص سداد رسوم الانتقال', 'Transportation Fee Payment Notice')}</span>
            </h4>
            <p className="leading-relaxed">
              {language === 'ar'
                ? 'تنويه بخصوص رسوم الانتقال: تُحسب رسوم الانتقال حسب المنطقة الجغرافية المحددة. يتم تأكيد الرسوم النهائية وطريقة السداد مع فريق أُنس قبل تأكيد الزيارة. يمكن سداد رسوم الانتقال عبر فودافون كاش أو إنستا باي وفقًا لتعليمات الفريق.'
                : 'Transportation fees are calculated according to the selected service area and are separate from the service fee. The final transportation amount and payment instructions will be confirmed by the ONS Healthcare team before the visit is confirmed. Payment can be made through Vodafone Cash or InstaPay according to the instructions provided by our team.'}
            </p>
          </div>
        </div>

        {/* Final Submit Actions */}
        <div className="pt-2 space-y-4">
          <label className="flex items-start gap-2.5 cursor-pointer text-xs text-[#153B36]/85 font-semibold">
            <input
              type="checkbox"
              required
              checked={acceptTerms}
              onChange={(e) => setAcceptTerms(e.target.checked)}
              className="w-4 h-4 rounded-md accent-[#153B36] mt-0.5 shrink-0"
            />
            <span>
              {t(
                'أوافق على الشروط والأحكام الطبية وسياسة الاستخدام وإقرار سرية البيانات والخصوصية لشركة أُنس للرعاية الصحية.',
                'I agree to the medical terms, privacy policy, and clinical care coordination agreements of ONS Healthcare.'
              )}
            </span>
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 rounded-2xl bg-[#153B36] hover:bg-[#0D2622] text-[#F5F2EB] text-sm font-extrabold shadow-lg flex items-center justify-center gap-3 transition-all disabled:opacity-50 cursor-pointer active:scale-98"
          >
            {isSubmitting ? (
              <>
                <div className="w-5 h-5 border-2 border-[#70A69A] border-t-transparent rounded-full animate-spin" />
                <span>{t('جاري اعتماد إرسال الطلب...', 'Submitting request...')}</span>
              </>
            ) : (
              <>
                <CalendarPlus className="w-5 h-5 text-[#70A69A]" />
                <span>{t('تأكيد وإرسال طلب الخدمة الآن', 'Confirm & Submit Healthcare Request')}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
