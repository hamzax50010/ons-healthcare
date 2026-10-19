import React, { useState } from 'react';
import { useData } from '../../../context/DataContext';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { CustomerRequest, RequestStatus } from '../../../types';
import {
  Inbox,
  Search,
  Filter,
  CheckCircle,
  XCircle,
  Clock,
  Phone,
  MapPin,
  Calendar,
  AlertCircle,
  FileText,
  User,
  DollarSign,
  MessageSquare,
  Shield,
  X,
  History,
  Users,
  CheckCircle2,
  Package,
  Navigation,
  ExternalLink,
  Lock,
  RefreshCw,
  Info,
  Send,
  Award,
  Trash2,
} from 'lucide-react';
import { buildWhatsAppLink, generateCustomerConfirmationMessage } from '../../../utils/whatsappUtils';
import { estimateDriveMinutes } from '../../../utils/geoUtils';

export const RequestsTab: React.FC = () => {
  const {
    requests,
    areas,
    services,
    settings,
    providers,
    matchProviders,
    assignRequestProvider,
    updateRequestStatus,
    updateRequestNearestProvidersToggle,
    updateRequestConfirmedPrice,
    updateRequestAdminNotes,
    retryTelegramNotification,
    deleteCustomerRequest,
  } = useData();
  const { language, t } = useLanguage();
  const { user } = useAuth();

  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [areaFilter, setAreaFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRequest, setSelectedRequest] = useState<CustomerRequest | null>(null);

  // Telegram retry state
  const [isRetryingTelegram, setIsRetryingTelegram] = useState<boolean>(false);
  const [telegramRetryFeedback, setTelegramRetryFeedback] = useState<string | null>(null);

  // Modal edit fields
  const [newStatus, setNewStatus] = useState<RequestStatus>('new');
  const [confirmedPrice, setConfirmedPrice] = useState<string>('');
  const [transitionNote, setTransitionNote] = useState<string>('');
  const [adminNotes, setAdminNotes] = useState<string>('');
  const [cancellationReason, setCancellationReason] = useState<string>('');
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>('');
  const [quoteSuppliesFee, setQuoteSuppliesFee] = useState<number>(0);
  const [quoteLabFee, setQuoteLabFee] = useState<number>(0);
  const [quoteTravelFee, setQuoteTravelFee] = useState<number>(60);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [showAllCandidates, setShowAllCandidates] = useState<boolean>(false);

  const filteredRequests = requests.filter((req) => {
    const matchesStatus = statusFilter === 'all' || req.status === statusFilter;
    const matchesArea = areaFilter === 'all' || req.areaId === areaFilter;
    const s = searchQuery.toLowerCase();
    const matchesSearch =
      !s ||
      req.customerName.toLowerCase().includes(s) ||
      req.phone.includes(s) ||
      (req.whatsapp && req.whatsapp.includes(s)) ||
      req.serviceNameAr.toLowerCase().includes(s) ||
      req.serviceNameEn.toLowerCase().includes(s) ||
      req.id.toLowerCase().includes(s);
    return matchesStatus && matchesArea && matchesSearch;
  });

  const openDetails = (req: CustomerRequest) => {
    setSelectedRequest(req);
    setNewStatus(req.status);
    setConfirmedPrice(req.confirmedPrice ? String(req.confirmedPrice) : '');
    setAdminNotes(req.adminNotes || '');
    setCancellationReason(req.cancellationReason || '');
    setTransitionNote('');
    setSelectedCandidateId(req.assignedProviderId || '');
    setQuoteTravelFee(req.travelFee || (areas.find((a) => a.id === req.areaId)?.travelFee || 60));
    setQuoteSuppliesFee(req.quote?.suppliesFee?.amount || 0);
    setQuoteLabFee(req.quote?.labThirdPartyFee?.amount || 0);
    setTelegramRetryFeedback(null);
  };

  const handleRetryTelegramAlert = async () => {
    if (!selectedRequest) return;
    setIsRetryingTelegram(true);
    setTelegramRetryFeedback(null);
    try {
      const result = await retryTelegramNotification(selectedRequest.id);
      if (result.success) {
        setTelegramRetryFeedback(t('تم إرسال إشعار تيليجرام بنجاح لمجموعة العمليات والإدارة.', 'Telegram notification successfully dispatched.'));
      } else {
        setTelegramRetryFeedback(result.error || t('فشل إرسال إشعار تيليجرام.', 'Telegram notification dispatch failed.'));
      }
      const updated = requests.find((r) => r.id === selectedRequest.id);
      if (updated) {
        setSelectedRequest({ ...updated });
      }
    } catch (err: any) {
      setTelegramRetryFeedback(err.message || 'Error executing Telegram retry.');
    } finally {
      setIsRetryingTelegram(false);
    }
  };

  const handleDeleteRequest = async (id: string) => {
    const target = requests.find((r) => r.id === id);
    if (target && target.status === 'completed') {
      setFeedbackMsg({
        type: 'error',
        text: t(
          'لا يمكن حذف الطلبات المكتملة بنجاح للحفاظ على سلامة السجلات المالية والإدارية.',
          'Completed requests cannot be deleted to preserve financial and operational audit logs.'
        ),
      });
      return;
    }

    if (!window.confirm(t('هل أنت متأكد من حذف هذا الطلب نهائياً من النظام؟ لا يمكن التراجع عن هذا الإجراء.', 'Are you sure you want to permanently delete this customer request? This action cannot be undone.'))) return;
    setIsUpdating(true);
    setFeedbackMsg(null);
    try {
      const res = await deleteCustomerRequest(id);
      if (!res.success) {
        setFeedbackMsg({ type: 'error', text: res.reason || t('تعذر حذف الطلب.', 'Failed to delete request.') });
      } else {
        setFeedbackMsg({ type: 'success', text: t('تم حذف طلب الخدمة بنجاح.', 'Customer request deleted successfully.') });
        if (selectedRequest?.id === id) {
          setSelectedRequest(null);
        }
      }
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message || t('تعذر حذف الطلب.', 'Failed to delete request.') });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAssignProvider = async () => {
    if (!selectedRequest || !selectedCandidateId) return;
    setIsUpdating(true);
    try {
      await assignRequestProvider(
        selectedRequest.id,
        selectedCandidateId,
        quoteTravelFee,
        quoteSuppliesFee,
        quoteLabFee
      );
      const assigned = providers.find((p) => p.id === selectedCandidateId);
      const totalAmount = (assigned?.agreedRate || 200) + quoteTravelFee + quoteSuppliesFee + quoteLabFee;
      setConfirmedPrice(String(totalAmount));
      setSelectedRequest((prev) =>
        prev
          ? {
              ...prev,
              assignedProviderId: assigned?.id,
              assignedProviderName: assigned?.name,
              confirmedPrice: totalAmount,
              travelFee: quoteTravelFee,
            }
          : null
      );
    } catch (err: any) {
      console.warn('Assignment notice:', err?.message || err);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveStatusChange = async () => {
    if (!selectedRequest) return;
    setIsUpdating(true);
    try {
      const priceNum = confirmedPrice ? parseFloat(confirmedPrice) : undefined;
      const noteToSave =
        newStatus === 'cancelled' && cancellationReason
          ? `سبب الإلغاء: ${cancellationReason}`
          : transitionNote;

      const actorName = user?.email || 'Authorized Owner';

      await updateRequestStatus(
        selectedRequest.id,
        newStatus,
        noteToSave,
        priceNum,
        actorName
      );

      if (adminNotes !== (selectedRequest.adminNotes || '')) {
        await updateRequestAdminNotes(selectedRequest.id, adminNotes);
      }

      // Update local state in view
      const updatedItem = requests.find((r) => r.id === selectedRequest.id);
      if (updatedItem) {
        setSelectedRequest({
          ...updatedItem,
          status: newStatus,
          confirmedPrice: priceNum,
          adminNotes,
        });
      }
    } catch (err: any) {
      console.warn('Status change notice:', err?.message || err);
    } finally {
      setIsUpdating(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'new':
      case 'under_review':
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
            {t('طلب جديد', 'New Order')}
          </span>
        );
      case 'awaiting_customer_confirmation':
      case 'awaiting_confirmation':
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">
            {t('بانتظار تأكيد العميل', 'Awaiting Confirmation')}
          </span>
        );
      case 'confirmed_scheduled':
      case 'confirmed':
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            {t('مؤكد ومجدول', 'Confirmed & Scheduled')}
          </span>
        );
      case 'field_in_progress':
      case 'in_progress':
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-teal-100 text-teal-800 border border-teal-300">
            {t('جاري التنفيذ الميداني', 'Field In Progress')}
          </span>
        );
      case 'completed':
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800 border border-green-300">
            {t('مكتمل بنجاح', 'Completed')}
          </span>
        );
      case 'cancelled':
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-300">
            {t('ملغي', 'Cancelled')}
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-800 border border-slate-300">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Tab Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[#153B36]">
            {t('إدارة طلبات الرعاية ومطابقة الكوادر', 'Order Management & Provider Dispatch')}
          </h1>
          <p className="text-xs text-[#153B36]/70 mt-1">
            {t(
              'مراجعة طلبات الموقع، مطابقة أقرب كادر تمريضي مناسب، إشعارات تيليجرام التلقائية، واعتماد أسعار الزيارات.',
              'Review website orders, match nearest suitable nurses, monitor Telegram alerts, and confirm quotes.'
            )}
          </p>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackMsg && (
        <div
          className={`p-4 rounded-2xl flex items-center justify-between text-xs font-bold shadow-xs ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <span>{feedbackMsg.text}</span>
          <button
            onClick={() => setFeedbackMsg(null)}
            className="p-1 hover:opacity-75"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter and Search Controls */}
      <div className="bg-white p-4 rounded-2xl border border-[#153B36]/10 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#F5F2EB]/50 border border-[#153B36]/20 rounded-xl px-3 py-2 text-xs font-semibold text-[#153B36] focus:outline-hidden"
          >
            <option value="all">{t('كافة الحالات', 'All Orders')} ({requests.length})</option>
            <option value="new">{t('طلب جديد', 'New Order')} ({requests.filter(r => (r.status as string) === 'new' || (r.status as string) === 'under_review').length})</option>
            <option value="awaiting_customer_confirmation">{t('بانتظار تأكيد العميل', 'Awaiting Confirmation')} ({requests.filter(r => (r.status as string) === 'awaiting_customer_confirmation' || (r.status as string) === 'awaiting_confirmation').length})</option>
            <option value="confirmed_scheduled">{t('مؤكد ومجدول', 'Confirmed & Scheduled')} ({requests.filter(r => (r.status as string) === 'confirmed_scheduled' || (r.status as string) === 'confirmed').length})</option>
            <option value="field_in_progress">{t('جاري التنفيذ الميداني', 'Field In Progress')} ({requests.filter(r => (r.status as string) === 'field_in_progress' || (r.status as string) === 'in_progress').length})</option>
            <option value="completed">{t('مكتمل بنجاح', 'Completed')} ({requests.filter(r => r.status === 'completed').length})</option>
            <option value="cancelled">{t('ملغي', 'Cancelled')} ({requests.filter(r => r.status === 'cancelled').length})</option>
          </select>

          {/* Area filter */}
          <select
            value={areaFilter}
            onChange={(e) => setAreaFilter(e.target.value)}
            className="bg-[#F5F2EB]/50 border border-[#153B36]/20 rounded-xl px-3 py-2 text-xs font-semibold text-[#153B36] focus:outline-hidden"
          >
            <option value="all">{t('كافة المناطق', 'All Areas')}</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {language === 'ar' ? a.nameAr : a.nameEn}
              </option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div className="relative w-full md:w-64">
          <Search className="w-4 h-4 text-[#153B36]/50 absolute top-1/2 -translate-y-1/2 start-3" />
          <input
            type="text"
            placeholder={t('بحث بالاسم أو الهاتف أو المرجع...', 'Search name, phone, order ID...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#F5F2EB]/50 border border-[#153B36]/20 rounded-xl ps-9 pe-3 py-2 text-xs text-[#153B36] focus:outline-hidden"
          />
        </div>
      </div>

      {/* Requests Table */}
      {filteredRequests.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-3xl border border-[#153B36]/10 text-xs text-[#153B36]/60">
          <Inbox className="w-8 h-8 text-[#153B36]/30 mx-auto mb-2" />
          <p>{t('لا توجد طلبات تطابق معايير البحث المحددة.', 'No customer orders match the current criteria.')}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#153B36]/10 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-[#F5F2EB] text-[#153B36] border-b border-[#153B36]/10">
                <tr>
                  <th className="py-3 px-4 font-bold text-start">{t('المرجع', 'Ref ID')}</th>
                  <th className="py-3 px-4 font-bold text-start">{t('العميل', 'Customer')}</th>
                  <th className="py-3 px-4 font-bold text-start">{t('الخدمة المطلوبة', 'Service')}</th>
                  <th className="py-3 px-4 font-bold text-start">{t('المنطقة', 'Area')}</th>
                  <th className="py-3 px-4 font-bold text-start">{t('الهاتف / واتساب', 'Phone / WA')}</th>
                  <th className="py-3 px-4 font-bold text-start">{t('إشعار تيليجرام الإداري', 'Telegram Alert')}</th>
                  <th className="py-3 px-4 font-bold text-start">{t('الممارس المعين', 'Assigned Provider')}</th>
                  <th className="py-3 px-4 font-bold text-start">{t('الحالة', 'Status')}</th>
                  <th className="py-3 px-4 font-bold text-start">{t('التاريخ', 'Date')}</th>
                  <th className="py-3 px-4 font-bold text-center">{t('الإجراء', 'Action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#153B36]/10">
                {filteredRequests.map((req) => (
                  <tr
                    key={req.id}
                    className="hover:bg-[#F5F2EB]/40 transition-colors cursor-pointer"
                    onClick={() => openDetails(req)}
                  >
                    <td className="py-3 px-4 font-mono font-bold text-[#153B36] text-[11px]">{req.id}</td>
                    <td className="py-3 px-4 font-bold text-[#153B36]">{req.customerName}</td>
                    <td className="py-3 px-4 text-[#153B36]/80 font-medium">
                      {language === 'ar' ? req.serviceNameAr : req.serviceNameEn}
                    </td>
                    <td className="py-3 px-4 text-[#153B36]/70">
                      {language === 'ar' ? req.areaNameAr : req.areaNameEn}
                    </td>
                    <td className="py-3 px-4 font-mono text-[#153B36]" dir="ltr">
                      <div className="flex items-center gap-1.5">
                        {req.preferredContactMethod === 'whatsapp' ? (
                          <span title={t('تفضيل العميل: رسالة واتساب', 'Customer Preference: WhatsApp')} className="text-emerald-700 bg-emerald-100 p-1 rounded-full shrink-0">
                            <MessageSquare className="w-3.5 h-3.5" />
                          </span>
                        ) : req.preferredContactMethod === 'phone_call' ? (
                          <span title={t('تفضيل العميل: مكالمة تليفون', 'Customer Preference: Phone Call')} className="text-sky-700 bg-sky-100 p-1 rounded-full shrink-0">
                            <Phone className="w-3.5 h-3.5" />
                          </span>
                        ) : null}
                        <span>{req.phone || req.whatsapp}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {req.telegramNotificationSent || req.telegramNotificationLog?.status === 'sent' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-800 bg-sky-100 px-2 py-0.5 rounded-full border border-sky-300">
                          <CheckCircle2 className="w-3 h-3 text-sky-600" />
                          <span>{t('مرسل للتيليجرام', 'Dispatched')}</span>
                        </span>
                      ) : req.telegramNotificationLog?.status === 'failed' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-800 bg-rose-100 px-2 py-0.5 rounded-full border border-rose-300">
                          <XCircle className="w-3 h-3 text-rose-600" />
                          <span>{t('فشل الإرسال', 'Failed')}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                          <span>{t('غير مهيأ', 'Pending')}</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {req.assignedProviderName ? (
                        <span className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md">
                          {req.assignedProviderName}
                        </span>
                      ) : (
                        <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md font-semibold">
                          {t('غير معين', 'Unassigned')}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">{getStatusBadge(req.status)}</td>
                    <td className="py-3 px-4 text-[#153B36]/60">
                      {new Date(req.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => openDetails(req)}
                          className="px-3 py-1.5 rounded-lg bg-[#153B36] text-[#F5F2EB] text-[11px] font-semibold hover:bg-[#0D2622]"
                        >
                          {t('التفاصيل والمطابقة', 'Details & Dispatch')}
                        </button>
                        <button
                          onClick={() => handleDeleteRequest(req.id)}
                          className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 transition-colors"
                          title={t('حذف الطلب نهائياً', 'Delete Request')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Request Details & Matching Drawer Modal */}
      {selectedRequest && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[92vh] overflow-y-auto border border-[#153B36]/10 shadow-2xl p-6 sm:p-8 space-y-6">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-[#153B36]/10">
              <div>
                <span className="text-xs font-mono font-bold text-[#70A69A] block uppercase">
                  {selectedRequest.id}
                </span>
                <h2 className="text-xl font-extrabold text-[#153B36] mt-0.5">
                  {selectedRequest.customerName}
                </h2>
                <span className="text-xs text-[#153B36]/70 font-semibold block">
                  {language === 'ar' ? selectedRequest.serviceNameAr : selectedRequest.serviceNameEn}
                </span>
              </div>
              <button
                onClick={() => setSelectedRequest(null)}
                className="p-2 rounded-xl text-[#153B36]/60 hover:text-[#153B36] hover:bg-[#F5F2EB]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Customer Preferred Contact Method & Direct Actions */}
            <div className="p-4 rounded-2xl bg-white border border-[#153B36]/15 space-y-3 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-[#153B36]/10 gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#153B36]">
                    {t('طريقة التواصل المفضلة للعميل:', 'Preferred Contact Method:')}
                  </span>
                  {selectedRequest.preferredContactMethod === 'whatsapp' ? (
                    <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1.5 shadow-xs">
                      <MessageSquare className="w-3.5 h-3.5 text-emerald-700" />
                      <span>{t('رسالة واتساب (WhatsApp)', 'WhatsApp Message')}</span>
                    </span>
                  ) : selectedRequest.preferredContactMethod === 'phone_call' ? (
                    <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-sky-100 text-sky-800 border border-sky-300 flex items-center gap-1.5 shadow-xs">
                      <Phone className="w-3.5 h-3.5 text-sky-700" />
                      <span>{t('مكالمة تليفون (Phone Call)', 'Phone Call')}</span>
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-300">
                      {t('غير محدد (مكالمة / واتساب)', 'Not specified')}
                    </span>
                  )}
                </div>

                <span className="text-[11px] text-[#153B36]/60">
                  {t('تفضيل العميل لتأكيد الموعد والتفاصيل السريرية', 'Customer preference for booking confirmation')}
                </span>
              </div>

              {/* Numbers Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-[#F5F2EB]/60 text-xs">
                <div>
                  <span className="text-[#153B36]/70 block font-semibold">{t('رقم الهاتف الأساسي للاتصال:', 'Primary Phone:')}</span>
                  <a
                    href={`tel:${selectedRequest.phone}`}
                    className="font-bold font-mono text-sm text-[#153B36] hover:text-[#70A69A] block mt-0.5"
                    dir="ltr"
                  >
                    {selectedRequest.phone}
                  </a>
                </div>

                <div>
                  <span className="text-[#153B36]/70 block font-semibold flex items-center gap-1">
                    <span>{t('رقم الواتساب للتنسيق:', 'WhatsApp Number:')}</span>
                    {selectedRequest.whatsapp && selectedRequest.whatsapp !== selectedRequest.phone && (
                      <span className="text-[10px] text-amber-800 bg-amber-100 px-1.5 py-0.2 rounded font-bold">
                        {t('مختلف عن الهاتف', 'Separate')}
                      </span>
                    )}
                  </span>
                  <a
                    href={`https://wa.me/${(selectedRequest.whatsapp || selectedRequest.phone).replace(/[^\d]/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold font-mono text-sm text-emerald-700 hover:underline flex items-center gap-1 mt-0.5"
                    dir="ltr"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>{selectedRequest.whatsapp || selectedRequest.phone}</span>
                  </a>
                </div>

                <div>
                  <span className="text-[#153B36]/70 block font-semibold">{t('رسوم انتقال المنطقة:', 'Travel Fee:')}</span>
                  <span className="font-bold text-sm text-[#153B36] block mt-0.5">
                    {selectedRequest.travelFee || 0} {settings.currency}
                  </span>
                </div>
              </div>

              {/* Convenient Contact Action Buttons */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-1 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  {/* WhatsApp Action */}
                  <a
                    href={`https://wa.me/${(selectedRequest.whatsapp || selectedRequest.phone).replace(/[^\d]/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                      selectedRequest.preferredContactMethod === 'whatsapp'
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                        : 'border border-emerald-600/40 text-emerald-800 hover:bg-emerald-50 bg-white'
                    }`}
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span>{t('فتح محادثة واتساب', 'Open WhatsApp Chat')}</span>
                    <ExternalLink className="w-3 h-3 opacity-80" />
                  </a>

                  {/* Phone Call Action */}
                  <a
                    href={`tel:${selectedRequest.phone}`}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                      selectedRequest.preferredContactMethod === 'phone_call'
                        ? 'bg-[#153B36] hover:bg-[#0D2622] text-[#F5F2EB] shadow-xs'
                        : 'border border-[#153B36]/30 text-[#153B36] hover:bg-[#F5F2EB] bg-white'
                    }`}
                  >
                    <Phone className="w-4 h-4" />
                    <span>{t('إجراء مكالمة هاتفية', 'Direct Call Patient')}</span>
                  </a>
                </div>

                {/* Pre-filled confirmation text */}
                <a
                  href={buildWhatsAppLink(
                    selectedRequest.whatsapp || selectedRequest.phone,
                    generateCustomerConfirmationMessage(selectedRequest)
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-xl border border-emerald-600/30 text-emerald-800 hover:bg-emerald-50 text-[11px] font-semibold flex items-center gap-1 self-start sm:self-auto"
                >
                  <Send className="w-3 h-3 text-emerald-600" />
                  <span>{t('إرسال نص تأكيد الحجز الجاهز للواتساب', 'Send Booking Template')}</span>
                </a>
              </div>
            </div>



            {/* Automated Telegram Order Notification Status Card */}
            <div className="p-4 rounded-2xl bg-white border border-[#153B36]/15 space-y-3 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-[#153B36]/10 gap-2">
                <div className="flex items-center gap-2 text-[#153B36]">
                  <Send className="w-4 h-4 text-sky-600" />
                  <h3 className="text-xs font-extrabold uppercase tracking-wider">
                    {t('إشعار تيليجرام التلقائي للإدارة (Telegram Order Alert)', 'Automated Telegram Admin Alert')}
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  {selectedRequest.telegramNotificationLog?.status === 'sent' || selectedRequest.telegramNotificationSent ? (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      {t('تم الإرسال لتيليجرام بنجاح', 'Sent to Telegram')}
                    </span>
                  ) : selectedRequest.telegramNotificationLog?.status === 'failed' ? (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                      🔴 {t('فشل الإرسال لتيليجرام', 'Telegram Dispatch Failed')}
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
                      ⚪ {t('غير مهيأ في الخادم', 'Not Configured')}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-sky-50/50 border border-sky-100 space-y-1">
                  <span className="text-[11px] text-[#153B36]/70 block font-semibold">
                    {t('معرف المحادثة المستهدفة (Chat ID):', 'Target Chat ID:')}
                  </span>
                  <span className="font-mono text-xs font-bold text-[#153B36]" dir="ltr">
                    {selectedRequest.telegramNotificationLog?.chatId || t('معرف الإدارة المعتمد', 'Configured Admin Chat')}
                  </span>
                  {selectedRequest.telegramNotificationLog?.messageId && (
                    <span className="text-[10px] text-[#153B36]/60 font-mono block">
                      Message ID: {selectedRequest.telegramNotificationLog.messageId}
                    </span>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-[#F5F2EB]/50 border border-[#153B36]/10 space-y-1">
                  <span className="text-[11px] text-[#153B36]/70 block font-semibold">
                    {t('ترشيحات الكوادر بالإشعار:', 'Candidates in Alert:')}
                  </span>
                  <span className="text-xs font-bold text-[#153B36]">
                    {selectedRequest.telegramNotificationLog?.recommendedProvidersCount !== undefined
                      ? `${selectedRequest.telegramNotificationLog.recommendedProvidersCount} ${t('ممارسين مرشحين مرفقين بالإشعار', 'candidates dispatched')}`
                      : t('يتم إرفاق أقرب 3 ممارسين تلقائياً', 'Top 3 nearest candidates included')}
                  </span>
                </div>
              </div>

              {selectedRequest.telegramNotificationLog?.error && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                  <span className="font-bold">{t('سبب الخطأ:', 'Error Details:')} </span>
                  <span>{selectedRequest.telegramNotificationLog.error}</span>
                </div>
              )}

              {/* Action Banner */}
              <div className="pt-1 flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-[#153B36]/10">
                <span className="text-[11px] text-[#153B36]/60">
                  {selectedRequest.telegramNotificationLog?.lastAttemptAt
                    ? `${t('آخر محاولة:', 'Last attempt:')} ${new Date(selectedRequest.telegramNotificationLog.lastAttemptAt).toLocaleTimeString()}`
                    : t('يتم الإرسال تلقائياً عند حفظ الطلب', 'Automatic on new order creation')}
                </span>

                <button
                  type="button"
                  onClick={handleRetryTelegramAlert}
                  disabled={isRetryingTelegram}
                  className="px-3.5 py-1.5 rounded-xl border border-sky-600 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRetryingTelegram ? 'animate-spin' : ''}`} />
                  <span>{isRetryingTelegram ? t('جاري الإرسال...', 'Dispatching...') : t('إعادة إرسال إشعار تيليجرام (Retry)', 'Retry Telegram Alert')}</span>
                </button>
              </div>

              {telegramRetryFeedback && (
                <div className="p-2.5 rounded-xl bg-sky-50 border border-sky-200 text-xs font-semibold text-[#153B36] flex items-center gap-2">
                  <Info className="w-4 h-4 text-sky-600" />
                  <span>{telegramRetryFeedback}</span>
                </div>
              )}
            </div>

            {/* Full Address Details & Landmark */}
            <div className="space-y-3 text-xs">
              <div className="p-3.5 rounded-xl border border-[#153B36]/10 bg-white">
                <span className="font-bold text-[#153B36] block mb-1">
                  {t('العنوان التفصيلي وموقع الزيارة:', 'Full Address Details & Landmark:')}
                </span>
                <p className="text-[#153B36]/80 leading-relaxed font-mono">
                  {selectedRequest.addressDetails}
                </p>
                {selectedRequest.mapCoordinates ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2.5 mt-2 border-t border-[#153B36]/10">
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[#70A69A] font-semibold">
                      <Navigation className="w-3.5 h-3.5" />
                      <span>{selectedRequest.mapCoordinates.lat.toFixed(4)}, {selectedRequest.mapCoordinates.lng.toFixed(4)}</span>
                    </span>
                    <a
                      href={`https://www.google.com/maps?q=${selectedRequest.mapCoordinates.lat},${selectedRequest.mapCoordinates.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-[#153B36] hover:bg-[#0D2622] text-[#F5F2EB] font-bold text-[11px] flex items-center justify-center gap-1.5 transition-colors self-start sm:self-auto"
                    >
                      <MapPin className="w-3.5 h-3.5 text-[#70A69A]" />
                      <span>{t('فتح الموقع بدقة على Google Maps', 'Open Pin in Google Maps')}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ) : (
                  <div className="pt-2 mt-2 border-t border-[#153B36]/10 flex justify-end">
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedRequest.addressDetails} ${selectedRequest.areaNameAr || ''} القاهرة`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-[#153B36]/10 hover:bg-[#153B36]/20 text-[#153B36] font-bold text-[11px] flex items-center gap-1.5 transition-colors"
                    >
                      <MapPin className="w-3.5 h-3.5 text-[#70A69A]" />
                      <span>{t('بحث عن العنوان في خرائط Google', 'Search Address in Maps')}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>

              {selectedRequest.notes && (
                <div className="p-3.5 rounded-xl border border-[#153B36]/10 bg-white">
                  <span className="font-bold text-[#153B36] block mb-1">
                    {t('ملاحظات الحالة السريرية المسجلة من المريض:', 'Patient Condition Note:')}
                  </span>
                  <p className="text-[#153B36]/80 leading-relaxed italic">
                    "{selectedRequest.notes}"
                  </p>
                </div>
              )}

              {/* Uploaded Identity Document Display */}
              {selectedRequest.identityDocumentUrl && (
                <div className="p-3.5 rounded-xl border border-[#153B36]/10 bg-[#F5F2EB]/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-[#70A69A]" />
                    <span className="font-bold text-[#153B36]">
                      {t('مستند إثبات الهوية / الروشتة المرفوع:', 'Attached Identity Document:')}
                    </span>
                    <span className="font-mono text-[#153B36]/70 text-[11px]">
                      {selectedRequest.identityDocumentName || 'document'}
                    </span>
                  </div>
                  <a
                    href={selectedRequest.identityDocumentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1 rounded-lg bg-[#153B36] text-[#F5F2EB] text-[11px] font-semibold hover:bg-[#0D2622]"
                  >
                    {t('معاينة المستند بأمان', 'View Secure Document')}
                  </a>
                </div>
              )}
            </div>

            {/* SECTION: Nearest Suitable Providers (أقرب مقدمي الخدمة المناسبين) */}
            <div className="p-5 rounded-2xl bg-white border border-[#153B36]/15 space-y-4 shadow-xs">
              <div className="flex items-center justify-between pb-2 border-b border-[#153B36]/10">
                <div className="flex items-center gap-2 text-[#153B36]">
                  <Users className="w-4 h-4 text-[#70A69A]" />
                  <h3 className="text-sm font-extrabold">
                    {t('أقرب مقدمي الخدمة المناسبين', 'Nearest Suitable Providers')}
                  </h3>
                </div>

                {/* Toggle Switch Control (Disabled by Default) */}
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-[#153B36]">
                    {selectedRequest.isNearestProvidersEnabled
                      ? t('الميزة مفعّلة', 'Feature Enabled')
                      : t('الميزة معطّلة (افتراضي)', 'Disabled (Default)')}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      const nextVal = !selectedRequest.isNearestProvidersEnabled;
                      await updateRequestNearestProvidersToggle(selectedRequest.id, nextVal);
                      setSelectedRequest({ ...selectedRequest, isNearestProvidersEnabled: nextVal });
                    }}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                      selectedRequest.isNearestProvidersEnabled ? 'bg-[#153B36]' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        selectedRequest.isNearestProvidersEnabled ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {!selectedRequest.isNearestProvidersEnabled ? (
                /* Disabled State Banner */
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs text-slate-700">
                  <div className="flex items-center gap-2 font-bold text-[#153B36]">
                    <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>{t('ميزة «أقرب مقدمي الخدمة المناسبين» معطّلة حالياً لهذا الطلب', 'Feature is currently disabled for this request')}</span>
                  </div>
                  <p className="text-slate-600 leading-relaxed">
                    {t(
                      'الميزة معطّلة افتراضياً. عند التعطيل لا يتم تشغيل البحث السريري أو عرض ترشيحات الممارسين. لتفعيل البحث وعرض أقرب الممارسين، قم بتشغيل مفتاح التحكم أعلاه.',
                      'This feature is disabled by default. When disabled, automatic candidate searching is suspended. Toggle the switch above to enable provider search.'
                    )}
                  </p>
                </div>
              ) : (
                /* Enabled State: Top 3 Candidates and Itemized Quote */
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-1">
                    <div className="flex items-center gap-1.5">
                      <Award className="w-4 h-4 text-amber-500" />
                      <span className="text-xs font-extrabold text-[#153B36]">
                        {t('ترشيحات النظام: أقرب 3 ممارسين مؤهلين جغرافياً للطلب', 'System Recommendations: Top 3 Nearest Qualified Providers')}
                      </span>
                    </div>
                    {selectedRequest.assignedProviderName ? (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                        {t('الممارس المعين:', 'Assigned:')} {selectedRequest.assignedProviderName}
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
                        {t('بانتظار تعيين ممارس', 'Unassigned')}
                      </span>
                    )}
                  </div>

                  {(() => {
                    const matchedCandidates = matchProviders(selectedRequest.serviceId, selectedRequest.areaId, {
                      targetCoords: selectedRequest.mapCoordinates,
                      date: selectedRequest.preferredDate,
                    });
                    const top3 = matchedCandidates.slice(0, 3);
                    const remaining = matchedCandidates.slice(3);

                    if (top3.length === 0) {
                      return (
                        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 text-center font-semibold">
                          {t('لا يوجد ممارسون مسجلون يغطون هذه المنطقة والخدمة حالياً.', 'No eligible providers currently cover this area/service.')}
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-3">
                        {/* Top 3 Cards Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {top3.map((candidate, idx) => {
                            const isSelected = selectedCandidateId === candidate.id;
                            const driveTime = candidate.estimatedDistanceKm
                              ? estimateDriveMinutes(candidate.estimatedDistanceKm)
                              : null;
                            const rankLabels = [
                              { medal: '🥇 #1', title: t('المرشح الأول (الأقرب جغرافياً)', 'Top #1 Nearest Candidate'), border: 'border-amber-300 bg-amber-50/40' },
                              { medal: '🥈 #2', title: t('المرشح الثاني', 'Rank #2 Candidate'), border: 'border-slate-300 bg-slate-50/40' },
                              { medal: '🥉 #3', title: t('المرشح الثالث', 'Rank #3 Candidate'), border: 'border-amber-700/20 bg-orange-50/30' },
                            ];
                            const rank = rankLabels[idx] || rankLabels[2];

                            return (
                              <div
                                key={candidate.id}
                                className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between ${
                                  isSelected
                                    ? 'bg-[#153B36] text-[#F5F2EB] border-[#153B36] shadow-lg ring-2 ring-[#70A69A]'
                                    : `${rank.border} hover:bg-white hover:border-[#153B36]/30 text-[#153B36]`
                                }`}
                              >
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between pb-1.5 border-b border-current/15">
                                    <span className={`text-[11px] font-extrabold flex items-center gap-1 ${isSelected ? 'text-amber-300' : 'text-amber-800'}`}>
                                      <span>{rank.medal}</span>
                                      <span>{rank.title}</span>
                                    </span>
                                    <span className="text-[11px] font-bold">
                                      {candidate.agreedRate} EGP
                                    </span>
                                  </div>

                                  <div>
                                    <h4 className="text-xs font-bold leading-tight">{candidate.name}</h4>
                                    <p className="text-[11px] opacity-80 mt-0.5 line-clamp-1">
                                      {language === 'ar' ? candidate.specialtyAr : candidate.specialtyEn}
                                    </p>
                                  </div>

                                  <div className="space-y-1 text-[11px] pt-1">
                                    <div className="flex items-center gap-1.5">
                                      <Navigation className="w-3.5 h-3.5 text-[#70A69A] shrink-0" />
                                      <span>
                                        {candidate.estimatedDistanceKm !== undefined
                                          ? `${candidate.estimatedDistanceKm} كم (~${driveTime} دقيقة بالسيارة)`
                                          : t('تطابق نطاق المنطقة الجغرافية', 'Area match')}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 opacity-90 font-mono text-[10px]" dir="ltr">
                                      <Phone className="w-3 h-3 text-[#70A69A] shrink-0" />
                                      <span>{candidate.phone}</span>
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => setSelectedCandidateId(candidate.id)}
                                  className={`mt-3 w-full py-1.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                                    isSelected
                                      ? 'bg-[#70A69A] text-[#153B36] shadow-xs'
                                      : 'bg-[#153B36] hover:bg-[#0D2622] text-[#F5F2EB]'
                                  }`}
                                >
                                  {isSelected ? (
                                    <>
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      <span>{t('تم اختياره للتعيين', 'Selected for Assignment')}</span>
                                    </>
                                  ) : (
                                    <span>{t('اختيار هذا الممارس للتعيين', 'Select Candidate')}</span>
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        {/* Other candidates toggle if > 3 */}
                        {remaining.length > 0 && (
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() => setShowAllCandidates(!showAllCandidates)}
                              className="text-xs font-bold text-[#153B36] hover:text-[#70A69A] flex items-center gap-1 transition-colors"
                            >
                              <span>
                                {showAllCandidates
                                  ? t('إخفاء باقي الممارسين المؤهلين', 'Hide remaining candidates')
                                  : t(`عرض باقي الممارسين المؤهلين (${remaining.length})`, `Show ${remaining.length} other qualified candidates`)}
                              </span>
                            </button>

                            {showAllCandidates && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pt-2 border-t border-[#153B36]/10">
                                {remaining.map((cand) => (
                                  <div
                                    key={cand.id}
                                    onClick={() => setSelectedCandidateId(cand.id)}
                                    className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all flex items-center justify-between ${
                                      selectedCandidateId === cand.id
                                        ? 'bg-[#153B36] text-[#F5F2EB] border-[#153B36]'
                                        : 'bg-[#F5F2EB]/50 border-[#153B36]/10 hover:bg-white text-[#153B36]'
                                    }`}
                                  >
                                    <div>
                                      <div className="font-bold text-xs">{cand.name}</div>
                                      <div className="text-[10px] opacity-75">{cand.specialtyAr}</div>
                                    </div>
                                    <div className="text-end">
                                      <div className="font-mono text-xs">{cand.agreedRate} EGP</div>
                                      <div className="text-[10px] opacity-75">
                                        {cand.estimatedDistanceKm !== undefined ? `${cand.estimatedDistanceKm} كم` : t('منطقة', 'Area')}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Itemized Quote Calculator */}
                  <div className="p-3.5 rounded-xl bg-[#F5F2EB] space-y-3 text-xs">
                    <span className="font-bold text-[#153B36] block">
                      {t('إعداد عرض السعر المفصل للزيارة (Itemized Quote):', 'Itemized Visit Quote:')}
                    </span>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="text-[11px] text-[#153B36]/70 block mb-1">
                          {t('رسوم الخدمة (ج.م)', 'Service Fee')}
                        </label>
                        <input
                          type="number"
                          readOnly
                          value={providers.find((p) => p.id === selectedCandidateId)?.agreedRate || 200}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-[#153B36]/20 bg-white/70 font-mono font-bold text-[#153B36]"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] text-[#153B36]/70 block mb-1">
                          {t('رسوم الانتقال (ج.م)', 'Travel Fee')}
                        </label>
                        <input
                          type="number"
                          value={quoteTravelFee}
                          onChange={(e) => setQuoteTravelFee(Number(e.target.value))}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-[#153B36]/20 bg-white font-mono font-bold text-[#153B36]"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] text-[#153B36]/70 block mb-1">
                          {t('مستلزمات طبية (ج.م)', 'Supplies')}
                        </label>
                        <input
                          type="number"
                          value={quoteSuppliesFee}
                          onChange={(e) => setQuoteSuppliesFee(Number(e.target.value))}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-[#153B36]/20 bg-white font-mono font-bold text-[#153B36]"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] text-[#153B36]/70 block mb-1">
                          {t('رسوم معمل (ج.م)', 'Lab Fee')}
                        </label>
                        <input
                          type="number"
                          value={quoteLabFee}
                          onChange={(e) => setQuoteLabFee(Number(e.target.value))}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-[#153B36]/20 bg-white font-mono font-bold text-[#153B36]"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-2 border-t border-[#153B36]/10">
                      <div className="text-xs">
                        <span className="text-[#153B36]/60">{t('إجمالي الفاتورة المتوقع:', 'Estimated Total Quote:')} </span>
                        <span className="font-extrabold text-[#153B36] text-sm font-mono">
                          {(providers.find((p) => p.id === selectedCandidateId)?.agreedRate || 200) +
                            quoteTravelFee +
                            quoteSuppliesFee +
                            quoteLabFee}{' '}
                          {settings.currency}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={handleAssignProvider}
                        disabled={!selectedCandidateId || isUpdating}
                        className="px-4 py-2 rounded-xl bg-[#153B36] hover:bg-[#0D2622] text-[#F5F2EB] text-xs font-bold transition-all disabled:opacity-50"
                      >
                        {t('تعيين الممارس وإعداد عرض السعر', 'Assign Provider & Set Quote')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Status & Rate Confirmation Section */}
            <div className="p-5 rounded-2xl bg-[#E7EFEA] border border-[#70A69A]/30 space-y-4">
              <h3 className="text-sm font-bold text-[#153B36] flex items-center gap-2">
                <Shield className="w-4 h-4 text-[#70A69A]" />
                <span>{t('تحديث حالة الرعاية وتأكيد السعر المعتمد', 'Update Order Status & Confirm Rate')}</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block font-bold text-[#153B36] mb-1">
                    {t('حالة الطلب (تتبع التسلسل القانوني)', 'Order Status')}
                  </label>
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as RequestStatus)}
                    className="w-full bg-white border border-[#153B36]/20 rounded-xl px-3 py-2 text-xs font-semibold text-[#153B36] focus:outline-hidden"
                  >
                    {/* Render status options based on strict sequential pipeline */}
                    {(() => {
                      const cur = selectedRequest.status as string;
                      const options: Array<{ value: RequestStatus; labelAr: string; labelEn: string }> = [];

                      if (cur === 'new' || cur === 'under_review') {
                        options.push({ value: 'new', labelAr: 'طلب جديد (الحالي)', labelEn: 'New (Current)' });
                        options.push({ value: 'awaiting_customer_confirmation', labelAr: 'بانتظار تأكيد العميل (الخطوة القادمة)', labelEn: 'Awaiting Customer Confirmation (Next)' });
                        options.push({ value: 'cancelled', labelAr: 'إلغاء الطلب', labelEn: 'Cancel Request' });
                      } else if (cur === 'awaiting_customer_confirmation' || cur === 'awaiting_confirmation') {
                        options.push({ value: 'awaiting_customer_confirmation', labelAr: 'بانتظار تأكيد العميل (الحالي)', labelEn: 'Awaiting Customer Confirmation (Current)' });
                        options.push({ value: 'confirmed_scheduled', labelAr: 'مؤكد ومجدول (الخطوة القادمة)', labelEn: 'Confirmed & Scheduled (Next)' });
                        options.push({ value: 'cancelled', labelAr: 'إلغاء الطلب', labelEn: 'Cancel Request' });
                      } else if (cur === 'confirmed_scheduled' || cur === 'confirmed') {
                        options.push({ value: 'confirmed_scheduled', labelAr: 'مؤكد ومجدول (الحالي)', labelEn: 'Confirmed & Scheduled (Current)' });
                        options.push({ value: 'field_in_progress', labelAr: 'جاري التنفيذ الميداني (الخطوة القادمة)', labelEn: 'Field In Progress (Next)' });
                        options.push({ value: 'cancelled', labelAr: 'إلغاء الطلب', labelEn: 'Cancel Request' });
                      } else if (cur === 'field_in_progress' || cur === 'in_progress') {
                        options.push({ value: 'field_in_progress', labelAr: 'جاري التنفيذ الميداني (الحالي)', labelEn: 'Field In Progress (Current)' });
                        options.push({ value: 'completed', labelAr: 'مكتمل بنجاح (الخطوة القادمة)', labelEn: 'Completed (Next)' });
                        options.push({ value: 'cancelled', labelAr: 'إلغاء الطلب', labelEn: 'Cancel Request' });
                      } else if (cur === 'completed') {
                        options.push({ value: 'completed', labelAr: 'مكتمل بنجاح (مغلق)', labelEn: 'Completed (Closed)' });
                      } else if (cur === 'cancelled') {
                        options.push({ value: 'cancelled', labelAr: 'ملغي (مغلق)', labelEn: 'Cancelled (Closed)' });
                      } else {
                        options.push({ value: cur as RequestStatus, labelAr: cur, labelEn: cur });
                        options.push({ value: 'cancelled', labelAr: 'إلغاء الطلب', labelEn: 'Cancel Request' });
                      }

                      return options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {language === 'ar' ? opt.labelAr : opt.labelEn}
                        </option>
                      ));
                    })()}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-[#153B36] mb-1">
                    {t('السعر المعتمد النهائي (EGP)', 'Final Approved Price (EGP)')}
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder={t('أدخل السعر المعتمد يدويًا...', 'Enter approved price...')}
                    value={confirmedPrice}
                    onChange={(e) => setConfirmedPrice(e.target.value)}
                    className="w-full bg-white border border-[#153B36]/20 rounded-xl px-3 py-2 text-xs font-mono font-bold text-[#153B36] focus:outline-hidden"
                  />
                  <span className="text-[10px] text-[#153B36]/60 mt-1 block">
                    {t('إدخال يدوي حصرًا من المشرف — لا يتغير تلقائيًا مع التقديرات.', 'Manual admin entry — strictly independent of base/provisional estimates.')}
                  </span>
                </div>
              </div>

              {newStatus === 'cancelled' && (
                <div>
                  <label className="block font-bold text-red-700 text-xs mb-1">
                    {t('سبب إلغاء الطلب *', 'Cancellation Reason *')}
                  </label>
                  <input
                    type="text"
                    placeholder={t('مثال: إلغاء بناءً على رغبة المريض، عدم توفر الكادر الطبي...', 'Reason...')}
                    value={cancellationReason}
                    onChange={(e) => setCancellationReason(e.target.value)}
                    className="w-full bg-white border border-red-300 rounded-xl px-3 py-2 text-xs text-red-900 focus:outline-hidden"
                  />
                </div>
              )}

              <div>
                <label className="block font-bold text-[#153B36] text-xs mb-1">
                  {t('ملاحظة انتقال الحالة (تظهر في سجل التدقيق)', 'Status Transition Note')}
                </label>
                <input
                  type="text"
                  placeholder={t('مثال: تم الاتصال وتأكيد ميعاد الزيارة غداً الساعة 10 ص', 'Audit log note...')}
                  value={transitionNote}
                  onChange={(e) => setTransitionNote(e.target.value)}
                  className="w-full bg-white border border-[#153B36]/20 rounded-xl px-3 py-2 text-xs text-[#153B36] focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-bold text-[#153B36] text-xs mb-1">
                  {t('ملاحظات إدارية وتشغيلية داخلية (محمية وسرية)', 'Internal Admin Notes (Restricted)')}
                </label>
                <textarea
                  rows={2}
                  placeholder={t('ملاحظات خاصة بفريق التمريض أو تاريخ الحالة...', 'Restricted internal operational notes...')}
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  className="w-full bg-white border border-[#153B36]/20 rounded-xl px-3 py-2 text-xs text-[#153B36] focus:outline-hidden"
                />
              </div>

              <div className="pt-2 flex items-center justify-between gap-3">
                {selectedRequest.status === 'completed' ? (
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 border border-slate-200 text-slate-500 text-[11px] font-semibold">
                    <Trash2 className="w-3.5 h-3.5 opacity-50" />
                    <span>{t('محظور حذف الطلب المكتمل لضمان سلامة السجلات المالية والإدارية', 'Deletion blocked for completed orders')}</span>
                  </div>
                ) : (
                  <button
                    onClick={() => handleDeleteRequest(selectedRequest.id)}
                    disabled={isUpdating}
                    className="px-4 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-1.5"
                    title={t('حذف الطلب نهائياً', 'Delete Request Permanently')}
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>{t('حذف الطلب', 'Delete Request')}</span>
                  </button>
                )}
                <button
                  onClick={handleSaveStatusChange}
                  disabled={isUpdating}
                  className="px-6 py-2.5 rounded-xl bg-[#153B36] hover:bg-[#0D2622] text-[#F5F2EB] text-xs font-bold transition-all disabled:opacity-50"
                >
                  {isUpdating ? t('جاري الحفظ...', 'Saving...') : t('حفظ التعديلات واعتماد الحالة', 'Save & Update Status')}
                </button>
              </div>
            </div>

            {/* Audit Trail History */}
            {selectedRequest.statusHistory && selectedRequest.statusHistory.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-[#153B36]/10 text-xs">
                <h4 className="font-bold text-[#153B36] flex items-center gap-2">
                  <History className="w-4 h-4 text-[#70A69A]" />
                  <span>{t('سجل التدقيق والتاريخ الإجرائي للحالة', 'Status History & Audit Trail')}</span>
                </h4>
                <div className="space-y-2">
                  {selectedRequest.statusHistory.map((entry, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-[#F5F2EB]/60 border border-[#153B36]/10 flex items-start justify-between gap-4"
                    >
                      <div>
                        <span className="font-bold text-[#153B36] block">
                          {entry.status} — {entry.note || 'تغيير الحالة'}
                        </span>
                        <span className="text-[10px] text-[#153B36]/60">
                          {t('بواسطة:', 'By:')} {entry.changedBy}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-[#153B36]/50 whitespace-nowrap">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
