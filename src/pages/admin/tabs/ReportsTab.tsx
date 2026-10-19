import React, { useState, useEffect } from 'react';
import { useData } from '../../../context/DataContext';
import { useLanguage } from '../../../context/LanguageContext';
import {
  FileSpreadsheet,
  Calendar,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ExternalLink,
  Lock,
  DollarSign,
  TrendingUp,
  Send,
  Info,
  Shield,
  Clock,
  Package,
} from 'lucide-react';

export const ReportsTab: React.FC = () => {
  const { requests } = useData();
  const { language, t } = useLanguage();

  const [loading, setLoading] = useState<boolean>(true);
  const [exporting, setExporting] = useState<boolean>(false);
  const [statusData, setStatusData] = useState<any>(null);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>('');
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/reports/monthly-status');
      const data = await res.json();
      if (data.success) {
        setStatusData(data);
        if (data.currentCairoMonth?.monthKey && !selectedMonthKey) {
          setSelectedMonthKey(data.currentCairoMonth.monthKey);
        }
      }
    } catch (err: any) {
      console.warn('Error fetching monthly report status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleTriggerExport = async () => {
    setExporting(true);
    setFeedbackMsg(null);
    try {
      const res = await fetch('/api/reports/monthly-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetMonthKey: selectedMonthKey,
          clientOrders: requests,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setFeedbackMsg({
          type: 'success',
          text: t(
            `تم إقفال وتصدير تقرير الشهر (${data.monthKey}) بنجاح إلى Google Sheets لـ ${data.exportedCount} طلب مكتمل، وتم إرسال الإشعار لـ Telegram.`,
            `Monthly report (${data.monthKey}) successfully exported to Google Sheets for ${data.exportedCount} completed orders and notified via Telegram.`
          ),
        });
        await fetchStatus();
      } else {
        setFeedbackMsg({
          type: 'error',
          text: data.error || t('فشل تصدير التقرير الشهري إلى Google Sheets.', 'Failed to export monthly report.'),
        });
      }
    } catch (err: any) {
      setFeedbackMsg({
        type: 'error',
        text: err.message || t('خطأ غير متوقع أثناء التصدير.', 'Unexpected export error.'),
      });
    } finally {
      setExporting(false);
    }
  };

  const completedOrders = requests.filter((r) => r.status === 'completed');

  // Month selector options
  const monthOptions = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const arMonths = [
      'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
      'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
    ];
    const mLabel = `${arMonths[d.getMonth()]} ${d.getFullYear()} (${mKey})`;
    monthOptions.push({ key: mKey, label: mLabel });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-[#153B36] flex items-center gap-2.5">
          <FileSpreadsheet className="w-7 h-7 text-[#70A69A]" />
          <span>{t('إقفال التقارير الشهرية وتصدير Google Sheets', 'Monthly Closing & Google Sheets Export')}</span>
        </h1>
        <p className="text-xs text-[#153B36]/70 mt-1">
          {t(
            'نظام تلقائي آمن لإقفال التقارير الشهرية، تصدير بيانات الطلبات المكتملة إلى Google Sheets، وإرسال إشعارات الإشراف عبر تيليجرام وفق توقيت القاهرة.',
            'Automated, secure monthly closing system exporting completed orders to Google Sheets with Telegram notifications in Cairo timezone.'
          )}
        </p>
      </div>

      {/* Deletion Protection Shield Card */}
      <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-600/30 flex items-start gap-3 text-xs text-[#153B36]">
        <Lock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h4 className="font-extrabold text-amber-900">
            {t('حماية السجلات التاريخية من الحذف (Permanent Deletion Protection)', 'Permanent Deletion Protection Enforced')}
          </h4>
          <p className="text-xs text-[#153B36]/80 leading-relaxed">
            {t(
              'بموجب قواعد الأمان في Firestore والنواة الخادمية، يُمُنع حذف أي طلب مكتمل بنجاح (completed) منعاً باتاً لضمان سلامة السجلات المالية والتقارير الشهرية. خيار الحذف ملغى نهائياً للطلبات المكتملة.',
              'Completed orders (completed) are permanently protected from deletion in Firestore Security Rules and backend logic to maintain historical financial audit trails.'
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
          <button onClick={() => setFeedbackMsg(null)} className="p-1 hover:opacity-75">
            ✕
          </button>
        </div>
      )}

      {/* Action Control Panel */}
      <div className="bg-white p-6 rounded-3xl border border-[#153B36]/15 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#153B36]/10">
          <div>
            <span className="text-xs font-bold text-[#70A69A] block uppercase">
              {t('توقيت الخادم المحلي: Africa/Cairo', 'Local Timezone: Africa/Cairo')}
            </span>
            <h2 className="text-lg font-extrabold text-[#153B36] mt-0.5">
              {t('تصدير التقرير الشهري المعتمد', 'Trigger Monthly Closing Export')}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-[#153B36]">
              {t('إجمالي الطلبات المكتملة بالنظام:', 'Total System Completed:')}
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300">
              {completedOrders.length} {t('طلب مكتمل', 'completed')}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          {/* Month Selection */}
          <div>
            <label className="block text-xs font-bold text-[#153B36] mb-1.5">
              {t('اختيار الشهر المستهدف للإقفال *', 'Target Closing Month *')}
            </label>
            <select
              value={selectedMonthKey}
              onChange={(e) => setSelectedMonthKey(e.target.value)}
              className="w-full bg-[#F5F2EB]/60 border border-[#153B36]/20 rounded-xl px-3.5 py-2.5 text-xs font-bold text-[#153B36] focus:outline-hidden"
            >
              {monthOptions.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Direct Spreadsheet Link if configured */}
          <div>
            <label className="block text-xs font-bold text-[#153B36] mb-1.5">
              {t('ملف Google Sheets الرئيسي المعتمد', 'Master Google Sheet File')}
            </label>
            {statusData?.spreadsheetUrl ? (
              <a
                href={statusData.spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-3.5 rounded-xl border border-emerald-600/30 text-emerald-800 hover:bg-emerald-50 text-xs font-bold flex items-center justify-between transition-all"
              >
                <span className="truncate">{statusData.spreadsheetId || 'Google Sheets File'}</span>
                <ExternalLink className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              </a>
            ) : (
              <div className="py-2.5 px-3.5 rounded-xl bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-600">
                {t('سيتم إنشاؤه تلقائياً عند أول تصدير', 'Will be created automatically on export')}
              </div>
            )}
          </div>

          {/* Trigger Button */}
          <div>
            <button
              type="button"
              onClick={handleTriggerExport}
              disabled={exporting || !selectedMonthKey}
              className="w-full py-2.5 px-4 rounded-xl bg-[#153B36] hover:bg-[#0D2622] text-[#F5F2EB] text-xs font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 shadow-xs"
            >
              <RefreshCw className={`w-4 h-4 ${exporting ? 'animate-spin' : ''}`} />
              <span>
                {exporting
                  ? t('جاري التصدير والمزامنة...', 'Exporting & Syncing...')
                  : t('تصدير ومزامنة مع Google Sheets', 'Export & Sync Google Sheets')}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Audit Log / History Table */}
      <div className="bg-white rounded-3xl border border-[#153B36]/15 shadow-xs overflow-hidden p-6 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-[#153B36]/10">
          <h3 className="text-sm font-extrabold text-[#153B36] flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#70A69A]" />
            <span>{t('سجل التقارير الشهرية والتصدير التاريخي', 'Monthly Export Audit Log & History')}</span>
          </h3>
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="p-1.5 rounded-lg text-[#153B36] hover:bg-[#F5F2EB] transition-colors"
            title={t('تحديث السجل', 'Refresh logs')}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {statusData?.logs && Object.keys(statusData.logs).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-[#F5F2EB] text-[#153B36] border-b border-[#153B36]/10 font-bold">
                <tr>
                  <th className="py-3 px-4 text-start">{t('الشهر المستهدف', 'Target Month')}</th>
                  <th className="py-3 px-4 text-start">{t('وقت التصدير', 'Export Date')}</th>
                  <th className="py-3 px-4 text-center">{t('الطلبات المكتملة', 'Completed')}</th>
                  <th className="py-3 px-4 text-start">{t('إجمالي المعتمد', 'Confirmed Total')}</th>
                  <th className="py-3 px-4 text-start">{t('رسوم الانتقال', 'Travel Fees')}</th>
                  <th className="py-3 px-4 text-start">{t('التحصيل الفعلي', 'Collected')}</th>
                  <th className="py-3 px-4 text-center">{t('حالة التصدير', 'Status')}</th>
                  <th className="py-3 px-4 text-center">{t('إشعار تيليجرام', 'Telegram')}</th>
                  <th className="py-3 px-4 text-center">{t('الرابط', 'Sheet Link')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#153B36]/10">
                {Object.values(statusData.logs)
                  .sort((a: any, b: any) => new Date(b.lastExportedAt).getTime() - new Date(a.lastExportedAt).getTime())
                  .map((log: any) => (
                    <tr key={log.monthKey} className="hover:bg-[#F5F2EB]/40 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-[#153B36]">
                        {log.monthKey} <span className="text-[11px] text-[#153B36]/60 font-sans">({log.monthNameAr})</span>
                      </td>
                      <td className="py-3 px-4 text-[#153B36]/70">
                        {new Date(log.lastExportedAt).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}
                      </td>
                      <td className="py-3 px-4 text-center font-bold font-mono text-[#153B36]">
                        {log.exportedCount}
                      </td>
                      <td className="py-3 px-4 font-mono text-emerald-800 font-bold">
                        {log.totalConfirmedAmount} ج.م
                      </td>
                      <td className="py-3 px-4 font-mono text-[#153B36]">
                        {log.totalTravelFees} ج.م
                      </td>
                      <td className="py-3 px-4 font-mono text-emerald-900 font-extrabold">
                        {log.totalCollectedAmount} ج.م
                      </td>
                      <td className="py-3 px-4 text-center">
                        {log.status === 'success' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-300">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>{t('ناجح', 'Success')}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-800 bg-rose-100 px-2.5 py-0.5 rounded-full border border-rose-300">
                            <XCircle className="w-3 h-3 text-rose-600" />
                            <span>{t('فشل', 'Failed')}</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {log.telegramNotified ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-800 bg-sky-100 px-2 py-0.5 rounded-full">
                            <Send className="w-3 h-3 text-sky-600" />
                            <span>{t('تم الإرسال', 'Notified')}</span>
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-500 font-semibold">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {log.spreadsheetUrl ? (
                          <a
                            href={log.spreadsheetUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded-lg inline-flex items-center gap-1 text-[11px] font-bold"
                          >
                            <span>Google Sheets</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center bg-[#F5F2EB]/50 rounded-2xl border border-[#153B36]/10 text-xs text-[#153B36]/60 space-y-1">
            <FileSpreadsheet className="w-8 h-8 text-[#70A69A] mx-auto mb-1 opacity-70" />
            <p className="font-bold">{t('لا توجد سجلات تصدير بعد.', 'No export audit logs recorded yet.')}</p>
            <p className="text-[11px]">
              {t('قم باختيار الشهر واضغط «تصدير ومزامنة مع Google Sheets» لبدء أول دورة إقفال.', 'Select a month and click Export to create your first monthly report.')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
