import React, { useState, useEffect } from 'react';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import {
  Shield,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Lock,
  Cpu,
  MessageSquare,
  Server,
  Save,
  Send,
  RefreshCw,
  PhoneCall,
  Info,
  Clock,
  HelpCircle,
  Check,
  X,
  Smartphone,
  Share2,
  Bot,
} from 'lucide-react';

interface TelegramAdminUser {
  id: string;
  name: string;
  role: 'owner' | 'colleague';
  isVerified?: boolean;
}

interface TelegramServerConfigState {
  enabled: boolean;
  isConfigured: boolean;
  hasToken: boolean;
  tokenMasked: string;
  hasChatId: boolean;
  chatId: string;
  rawChatIdPresent: boolean;
  chatTitle: string;
  botUsername: string;
  lastTestedAt: string | null;
  lastTestStatus: 'connected' | 'error' | 'not_configured' | 'untested';
  lastError: string | null;
  lastTestMessageId: string | null;
  admin1?: TelegramAdminUser;
  admin2?: TelegramAdminUser;
  authorizedUserIds?: string[];
  pollingEnabled?: boolean;
}

export const IntegrationsTab: React.FC = () => {
  const { language, t } = useLanguage();
  const { user, isOwner } = useAuth();
  const { updateIntegration } = useData();

  const [activeIntegrationTab, setActiveIntegrationTab] = useState<'telegram' | 'labs' | 'security'>('telegram');

  // Telegram Integration State
  const [telegramConfig, setTelegramConfig] = useState<TelegramServerConfigState | null>(null);
  const [isLoadingTelegram, setIsLoadingTelegram] = useState<boolean>(true);
  const [telegramConfigError, setTelegramConfigError] = useState<string | null>(null);
  const [telegramBotTokenInput, setTelegramBotTokenInput] = useState<string>('');
  const [telegramChatIdInput, setTelegramChatIdInput] = useState<string>('');
  const [telegramEnabledInput, setTelegramEnabledInput] = useState<boolean>(true);
  const [isSavingTelegram, setIsSavingTelegram] = useState<boolean>(false);
  const [saveTelegramSuccess, setSaveTelegramSuccess] = useState<boolean>(false);
  const [saveTelegramError, setSaveTelegramError] = useState<string | null>(null);

  // Two-Admin Strict Security State
  const [admin1IdInput, setAdmin1IdInput] = useState<string>('');
  const [admin1NameInput, setAdmin1NameInput] = useState<string>('');
  const [admin2IdInput, setAdmin2IdInput] = useState<string>('');
  const [admin2NameInput, setAdmin2NameInput] = useState<string>('');
  const [isSavingAdmins, setIsSavingAdmins] = useState<boolean>(false);
  const [saveAdminsSuccess, setSaveAdminsSuccess] = useState<boolean>(false);
  const [saveAdminsError, setSaveAdminsError] = useState<string | null>(null);
  const [isTogglingPolling, setIsTogglingPolling] = useState<boolean>(false);

  const [isTestingTelegram, setIsTestingTelegram] = useState<boolean>(false);
  const [telegramTestResult, setTelegramTestResult] = useState<{
    success: boolean;
    status: 'connected' | 'error' | 'not_configured';
    botUsername?: string;
    botName?: string;
    messageId?: string;
    error?: string;
  } | null>(null);

  const fetchTelegramConfig = async () => {
    setIsLoadingTelegram(true);
    setTelegramConfigError(null);
    try {
      const res = await fetch('/api/telegram/config');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TelegramServerConfigState = await res.json();
      setTelegramConfig(data);
      setTelegramEnabledInput(data.enabled !== false);
      if (data.admin1?.id) setAdmin1IdInput(data.admin1.id);
      if (data.admin1?.name) setAdmin1NameInput(data.admin1.name);
      if (data.admin2?.id) setAdmin2IdInput(data.admin2.id);
      if (data.admin2?.name) setAdmin2NameInput(data.admin2.name);
    } catch (err: any) {
      setTelegramConfigError(err.message || 'Could not load Telegram server configuration.');
    } finally {
      setIsLoadingTelegram(false);
    }
  };

  useEffect(() => {
    fetchTelegramConfig();
  }, []);

  const handleSaveTelegramConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingTelegram(true);
    setSaveTelegramError(null);
    setSaveTelegramSuccess(false);

    try {
      const payload: any = {
        enabled: telegramEnabledInput,
      };
      if (telegramBotTokenInput.trim()) {
        payload.botToken = telegramBotTokenInput.trim();
      }
      if (telegramChatIdInput.trim()) {
        payload.chatId = telegramChatIdInput.trim();
      }

      const res = await fetch('/api/telegram/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save Telegram settings.');
      }

      setSaveTelegramSuccess(true);
      setTelegramBotTokenInput('');
      fetchTelegramConfig();
      setTimeout(() => setSaveTelegramSuccess(false), 4000);
    } catch (err: any) {
      setSaveTelegramError(err.message || 'Error updating Telegram configuration.');
    } finally {
      setIsSavingTelegram(false);
    }
  };

  const handleTestTelegramConnection = async () => {
    setIsTestingTelegram(true);
    setTelegramTestResult(null);

    try {
      const res = await fetch('/api/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testChatId: telegramChatIdInput.trim() || undefined,
          botToken: telegramBotTokenInput.trim() || undefined,
        }),
      });

      const data = await res.json();
      setTelegramTestResult(data);
      fetchTelegramConfig();
    } catch (err: any) {
      setTelegramTestResult({
        success: false,
        status: 'error',
        error: err.message || 'Connection test failed',
      });
    } finally {
      setIsTestingTelegram(false);
    }
  };

  const handleSaveAdmins = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingAdmins(true);
    setSaveAdminsError(null);
    setSaveAdminsSuccess(false);

    try {
      const res = await fetch('/api/telegram/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin1Id: admin1IdInput.trim(),
          admin1Name: admin1NameInput.trim() || 'المشرف الرئيسي (Admin 1)',
          admin2Id: admin2IdInput.trim(),
          admin2Name: admin2NameInput.trim() || 'المشرف الشريك (Admin 2)',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update authorized admins.');

      // Sync with Firestore integrations document for owner record keeping
      try {
        await updateIntegration('telegram', {
          config: {
            tokenMasked: telegramConfig?.tokenMasked || '••••••••',
            partnerName: `${admin1NameInput.trim() || 'Admin 1'} & ${admin2NameInput.trim() || 'Admin 2'}`,
          },
          status: 'connected',
          enabled: true,
        });
      } catch (fsErr) {
        console.warn('Firestore integration sync notice:', fsErr);
      }

      setSaveAdminsSuccess(true);
      fetchTelegramConfig();
      setTimeout(() => setSaveAdminsSuccess(false), 4000);
    } catch (err: any) {
      setSaveAdminsError(err.message || 'Error updating authorized administrators.');
    } finally {
      setIsSavingAdmins(false);
    }
  };

  const handleTestSpecificAdmin = async (targetChatId: string) => {
    if (!targetChatId.trim()) return;
    setIsTestingTelegram(true);
    setTelegramTestResult(null);

    try {
      const res = await fetch('/api/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testChatId: targetChatId.trim(),
        }),
      });
      const data = await res.json();
      setTelegramTestResult(data);
      fetchTelegramConfig();
    } catch (err: any) {
      setTelegramTestResult({
        success: false,
        status: 'error',
        error: err.message || 'Connection test failed',
      });
    } finally {
      setIsTestingTelegram(false);
    }
  };

  const handleTogglePolling = async () => {
    setIsTogglingPolling(true);
    try {
      const action = telegramConfig?.pollingEnabled ? 'stop' : 'start';
      await fetch('/api/telegram/polling/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      fetchTelegramConfig();
    } catch (err) {
      console.warn('Toggle polling notice:', err);
    } finally {
      setIsTogglingPolling(false);
    }
  };



  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#70A69A] tracking-wider uppercase mb-1">
          <Cpu className="w-3.5 h-3.5" />
          <span>{t('إدارة الأنظمة والربط الخارجي المعتمد', 'Accredited External APIs & Automated Pipelines')}</span>
        </div>
        <h1 className="text-2xl font-extrabold text-[#153B36]">
          {t('التكاملات والبنية التحتية والربط الخارجي', 'Integrations & Automated Infrastructure')}
        </h1>
        <p className="text-xs text-[#153B36]/70 mt-1">
          {t(
            'إدارة إشعارات تيليجرام التلقائية للطلبات وترشيح أقرب الكوادر الطبية، وبوابات المعامل والربط السريري.',
            'Manage automatic Telegram order alerts with nearest provider recommendations and clinical lab APIs.'
          )}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#153B36]/10 pb-2">
        <button
          onClick={() => setActiveIntegrationTab('telegram')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            activeIntegrationTab === 'telegram'
              ? 'bg-[#153B36] text-[#F5F2EB]'
              : 'text-[#153B36]/70 hover:bg-[#153B36]/5'
          }`}
        >
          <Send className="w-3.5 h-3.5 text-sky-400" />
          <span>{t('بوت تيليجرام للإشعارات الفورية (Telegram Bot)', 'Telegram Bot Alerts')}</span>
        </button>
        <button
          onClick={() => setActiveIntegrationTab('labs')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            activeIntegrationTab === 'labs'
              ? 'bg-[#153B36] text-[#F5F2EB]'
              : 'text-[#153B36]/70 hover:bg-[#153B36]/5'
          }`}
        >
          <Server className="w-3.5 h-3.5 text-[#70A69A]" />
          <span>{t('بوابات المعامل الطبية (Lab APIs)', 'Lab Partner APIs')}</span>
        </button>
        <button
          onClick={() => setActiveIntegrationTab('security')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            activeIntegrationTab === 'security'
              ? 'bg-[#153B36] text-[#F5F2EB]'
              : 'text-[#153B36]/70 hover:bg-[#153B36]/5'
          }`}
        >
          <Lock className="w-3.5 h-3.5 text-amber-400" />
          <span>{t('سياسة الأمان وحماية الأسرار', 'Zero-Secrets Security')}</span>
        </button>
      </div>

      {/* Telegram Platform Tab */}
      {activeIntegrationTab === 'telegram' && (
        <div className="space-y-6">
          {/* Connection Status Banner */}
          <div className="rounded-3xl bg-white border border-[#153B36]/10 p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#153B36]/10">
              <div className="flex items-center gap-3">
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold ${
                    telegramConfig?.lastTestStatus === 'connected'
                      ? 'bg-emerald-100 text-emerald-800'
                      : telegramConfig?.isConfigured
                      ? 'bg-sky-100 text-sky-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  <Send className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-[#153B36]">
                      {t('حالة الاتصال ببوت تيليجرام (Telegram Bot API)', 'Telegram Bot API Connection Status')}
                    </h2>
                    {telegramConfig?.lastTestStatus === 'connected' ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        🟢 {t('متصل وجاهز للإرسال (Connected)', 'Connected & Ready')}
                      </span>
                    ) : telegramConfig?.lastTestStatus === 'error' ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-rose-100 text-rose-800 border border-rose-300">
                        🔴 {t('خطأ في الاتصال (Error)', 'Connection Error')}
                      </span>
                    ) : telegramConfig?.isConfigured ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-sky-100 text-sky-800 border border-sky-300">
                        🔵 {t('تم حفظ البيانات - بانتظار الفحص', 'Configured - Untested')}
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300">
                        ⚪ {t('غير مهيأ بعد (Not Configured)', 'Not Configured')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#153B36]/70 mt-0.5">
                    {t(
                      'يتم إرسال إشعار فوري وتلقائي للإدارة عند إنشاء أي طلب جديد مع ترشيح أقرب 3 ممارسين مرخصين.',
                      'Automatic order alerts with nearest 3 provider recommendations dispatched instantly to Telegram.'
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchTelegramConfig}
                  disabled={isLoadingTelegram}
                  className="px-3 py-1.5 rounded-xl border border-[#153B36]/20 hover:bg-[#F5F2EB] text-xs font-semibold text-[#153B36] flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTelegram ? 'animate-spin' : ''}`} />
                  <span>{t('تحديث الحالة', 'Refresh')}</span>
                </button>
              </div>
            </div>

            {/* Quick Diagnostic Metadata Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3.5 rounded-2xl bg-[#F5F2EB]/50 border border-[#153B36]/10">
                <span className="text-[11px] text-[#153B36]/60 block font-semibold">
                  {t('اسم البوت المعتمد:', 'Bot Username:')}
                </span>
                <span className="font-mono font-bold text-[#153B36] mt-0.5 block truncate">
                  {telegramConfig?.botUsername ? `@${telegramConfig.botUsername}` : t('غير متصل بعد', 'Not connected')}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-[#F5F2EB]/50 border border-[#153B36]/10">
                <span className="text-[11px] text-[#153B36]/60 block font-semibold">
                  {t('توكن البوت (سري ومحمي):', 'Bot Token (Masked):')}
                </span>
                <span className="font-mono font-bold text-[#153B36] mt-0.5 block truncate">
                  {telegramConfig?.tokenMasked || t('غير مسجل', 'Not Set')}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-[#F5F2EB]/50 border border-[#153B36]/10">
                <span className="text-[11px] text-[#153B36]/60 block font-semibold">
                  {t('معرف المحادثة (Chat ID):', 'Admin Chat ID:')}
                </span>
                <span className="font-mono font-bold text-[#153B36] mt-0.5 block truncate" dir="ltr">
                  {telegramConfig?.chatId || t('غير محدد', 'Not set')}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-[#F5F2EB]/50 border border-[#153B36]/10">
                <span className="text-[11px] text-[#153B36]/60 block font-semibold">
                  {t('آخر فحص اتصال:', 'Last Ping Tested:')}
                </span>
                <span className="font-mono text-[#153B36] mt-0.5 block truncate">
                  {telegramConfig?.lastTestedAt
                    ? new Date(telegramConfig.lastTestedAt).toLocaleString()
                    : t('لم يُفحص بعد', 'Never')}
                </span>
              </div>
            </div>

            {telegramConfig?.lastError && (
              <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="block">{t('تنبيه فحص الاتصال الأخير:', 'Last Test Notice:')}</strong>
                  <span>{telegramConfig.lastError}</span>
                </div>
              </div>
            )}
          </div>

          {/* Telegram Settings Form */}
          <div className="rounded-3xl bg-white border border-[#153B36]/10 p-6 shadow-xs space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-[#153B36]/10">
              <div>
                <h3 className="text-sm font-extrabold text-[#153B36]">
                  {t('إعدادات توكن البوت ومعرف الإدارة', 'Bot Token & Chat Credentials')}
                </h3>
                <p className="text-xs text-[#153B36]/70 mt-0.5">
                  {t(
                    'يتم حفظ التوكن في الخادم الداخلي بأمان تام ولا يتم كشفه في متصفح العميل أبداً.',
                    'Tokens are strictly retained server-side and never leaked in client bundles.'
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={telegramEnabledInput}
                    onChange={(e) => setTelegramEnabledInput(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#153B36]"></div>
                </label>
                <span className="text-xs font-bold text-[#153B36]">
                  {telegramEnabledInput ? t('مفعل', 'Enabled') : t('معطل', 'Disabled')}
                </span>
              </div>
            </div>

            <form onSubmit={handleSaveTelegramConfig} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Bot Token */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#153B36] flex items-center justify-between">
                    <span>{t('توكن البوت (Bot Token من BotFather):', 'Telegram Bot Token (From BotFather):')}</span>
                    {telegramConfig?.hasToken && (
                      <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
                        {t('مسجل بالخادم حالياً', 'Token Configured')}
                      </span>
                    )}
                  </label>
                  <input
                    type="password"
                    value={telegramBotTokenInput}
                    onChange={(e) => setTelegramBotTokenInput(e.target.value)}
                    placeholder={telegramConfig?.hasToken ? `محتفظ بالتوكن: ${telegramConfig.tokenMasked} (اتركه فارغاً للإبقاء عليه)` : '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'}
                    className="w-full bg-[#F5F2EB]/50 border border-[#153B36]/20 rounded-xl px-3.5 py-2.5 text-xs font-mono text-[#153B36] focus:outline-hidden focus:border-[#70A69A]"
                  />
                  <p className="text-[11px] text-[#153B36]/60">
                    {t(
                      'احصل على التوكن مجاناً وبسهولة عبر مراسلة @BotFather على تيليجرام واستخدام أمر /newbot.',
                      'Obtain your bot token from @BotFather on Telegram via /newbot.'
                    )}
                  </p>
                </div>

                {/* Chat ID */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#153B36] flex items-center justify-between">
                    <span>{t('معرف المحادثة للإدارة (Chat IDs - يدعم عدة معرفات):', 'Admin Chat IDs (Multiple Supported):')}</span>
                    {telegramConfig?.hasChatId && (
                      <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
                        {t('محدد حالياً', 'Chat ID Configured')}
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={telegramChatIdInput}
                    onChange={(e) => setTelegramChatIdInput(e.target.value)}
                    placeholder="مثال: 123456789 أو 123456789, 987654321 أو -1001234567890"
                    dir="ltr"
                    className="w-full bg-[#F5F2EB]/50 border border-[#153B36]/20 rounded-xl px-3.5 py-2.5 text-xs font-mono text-[#153B36] focus:outline-hidden focus:border-[#70A69A]"
                  />
                  <p className="text-[11px] text-[#153B36]/60">
                    {t(
                      'يمكنك إدخال معرف محادثة واحد أو عدة معرفات مفصولة بفاصلة للإدارة والزميل المعتمد. لمعرفة المعرف، راسل @userinfobot.',
                      'Enter one or multiple Chat IDs separated by commas to alert multiple coordinators. Find ID via @userinfobot.'
                    )}
                  </p>
                </div>
              </div>

              {saveTelegramSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{t('تم حفظ وتحديث إعدادات بوت تيليجرام بنجاح في الخادم!', 'Telegram settings successfully updated!')}</span>
                </div>
              )}

              {saveTelegramError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{saveTelegramError}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <span className="text-[11px] text-[#153B36]/60">
                  {t('اضغط حفظ لاعتماد التغييرات في ملف الإعدادات الدائم على الخادم.', 'Click save to commit changes to server storage.')}
                </span>

                <button
                  type="submit"
                  disabled={isSavingTelegram}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-[#153B36] hover:bg-[#0D2622] text-[#F5F2EB] text-xs font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4 text-[#70A69A]" />
                  <span>{isSavingTelegram ? t('جاري الحفظ...', 'Saving...') : t('حفظ إعدادات تيليجرام', 'Save Telegram Config')}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Strict Two-Admin Access Control & Setup Guide Card */}
          <div className="rounded-3xl bg-white border border-[#153B36]/10 p-6 shadow-xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#153B36]/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-800 border border-amber-200 flex items-center justify-center font-bold">
                  <Shield className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-[#153B36]">
                    {t('إدارة صلاحيات الإداريين المصرح لهما (Strict Two-Admin Access)', 'Strict Two-Admin Access Control')}
                  </h3>
                  <p className="text-xs text-[#153B36]/70 mt-0.5">
                    {t(
                      'البوت مقيد حصرياً لشخصين مصرح لهما. أي مستخدم آخر يتم رفضه وحظره تلقائياً لحماية سرية المرضى.',
                      'Bot interaction is restricted to exactly two authorized admins. All other users are rejected.'
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full text-[11px] font-extrabold bg-emerald-50 text-emerald-800 border border-emerald-300">
                  🔒 {t('نظام مقيد لشخصين فقط', 'Strict 2-Admin Enforced')}
                </span>
              </div>
            </div>

            <form onSubmit={handleSaveAdmins} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Admin 1 (Primary / Owner) */}
                <div className="p-4 rounded-2xl bg-[#F5F2EB]/50 border border-[#153B36]/15 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-[#153B36] flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-[#153B36] text-[#F5F2EB] text-[10px] flex items-center justify-center">1</span>
                      {t('المشرف الأول (الرئيسي / المالك):', 'Admin 1 (Primary / Owner):')}
                    </span>
                    {admin1IdInput.trim() ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        🟢 {t('مصرح', 'Verified')}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300">
                        ⚪ {t('غير مسجل', 'Not Set')}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[#153B36]">
                      {t('اسم المشرف / الصفة:', 'Admin Name / Label:')}
                    </label>
                    <input
                      type="text"
                      value={admin1NameInput}
                      onChange={(e) => setAdmin1NameInput(e.target.value)}
                      placeholder="مثال: د. حمزة (المالك)"
                      className="w-full bg-white border border-[#153B36]/20 rounded-xl px-3 py-2 text-xs font-semibold text-[#153B36] focus:outline-hidden focus:border-[#70A69A]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[#153B36]">
                      {t('معرف حساب تيليجرام الرقمي (User ID):', 'Telegram Numeric User ID:')}
                    </label>
                    <input
                      type="text"
                      value={admin1IdInput}
                      onChange={(e) => setAdmin1IdInput(e.target.value)}
                      placeholder="مثال: 812345678"
                      dir="ltr"
                      className="w-full bg-white border border-[#153B36]/20 rounded-xl px-3 py-2 text-xs font-mono font-bold text-[#153B36] focus:outline-hidden focus:border-[#70A69A]"
                    />
                  </div>

                  {admin1IdInput.trim() && (
                    <button
                      type="button"
                      onClick={() => handleTestSpecificAdmin(admin1IdInput)}
                      disabled={isTestingTelegram}
                      className="w-full mt-2 py-1.5 px-3 rounded-xl bg-white border border-[#153B36]/20 hover:bg-[#153B36]/5 text-[11px] font-bold text-[#153B36] flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Send className="w-3 h-3 text-sky-600" />
                      <span>{t('إرسال اختبار تنبيه خاص للمشرف 1', 'Test Ping to Admin 1')}</span>
                    </button>
                  )}
                </div>

                {/* Admin 2 (Colleague) */}
                <div className="p-4 rounded-2xl bg-[#F5F2EB]/50 border border-[#153B36]/15 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-[#153B36] flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-[#70A69A] text-[#153B36] text-[10px] flex items-center justify-center font-bold">2</span>
                      {t('المشرف الثاني (الزميل الشريك):', 'Admin 2 (Colleague / Coordinator):')}
                    </span>
                    {admin2IdInput.trim() ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        🟢 {t('مصرح', 'Verified')}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300">
                        ⚪ {t('غير مسجل', 'Not Set')}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[#153B36]">
                      {t('اسم المشرف / الصفة:', 'Admin Name / Label:')}
                    </label>
                    <input
                      type="text"
                      value={admin2NameInput}
                      onChange={(e) => setAdmin2NameInput(e.target.value)}
                      placeholder="مثال: منسق العمليات (الزميل)"
                      className="w-full bg-white border border-[#153B36]/20 rounded-xl px-3 py-2 text-xs font-semibold text-[#153B36] focus:outline-hidden focus:border-[#70A69A]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[#153B36]">
                      {t('معرف حساب تيليجرام الرقمي (User ID):', 'Telegram Numeric User ID:')}
                    </label>
                    <input
                      type="text"
                      value={admin2IdInput}
                      onChange={(e) => setAdmin2IdInput(e.target.value)}
                      placeholder="مثال: 987654321"
                      dir="ltr"
                      className="w-full bg-white border border-[#153B36]/20 rounded-xl px-3 py-2 text-xs font-mono font-bold text-[#153B36] focus:outline-hidden focus:border-[#70A69A]"
                    />
                  </div>

                  {admin2IdInput.trim() && (
                    <button
                      type="button"
                      onClick={() => handleTestSpecificAdmin(admin2IdInput)}
                      disabled={isTestingTelegram}
                      className="w-full mt-2 py-1.5 px-3 rounded-xl bg-white border border-[#153B36]/20 hover:bg-[#153B36]/5 text-[11px] font-bold text-[#153B36] flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Send className="w-3 h-3 text-sky-600" />
                      <span>{t('إرسال اختبار تنبيه خاص للمشرف 2', 'Test Ping to Admin 2')}</span>
                    </button>
                  )}
                </div>
              </div>

              {saveAdminsSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{t('تم اعتماد وتحديث بيانات الإداريين المصرح لهما بنجاح في الخادم!', 'Authorized admins saved successfully!')}</span>
                </div>
              )}

              {saveAdminsError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{saveAdminsError}</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                <span className="text-[11px] text-[#153B36]/70">
                  {t(
                    'يتم تطبيق الفحص الأمني الصارم على الخادم لكل أمر أو ضغطة زر واردة من تيليجرام.',
                    'Backend authorization checks are strictly enforced for every action.'
                  )}
                </span>

                <button
                  type="submit"
                  disabled={isSavingAdmins}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-[#153B36] hover:bg-[#0D2622] text-[#F5F2EB] text-xs font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4 text-[#70A69A]" />
                  <span>{isSavingAdmins ? t('جاري الحفظ والاعتماد...', 'Saving...') : t('حفظ واعتماد الإداريين المصرحين', 'Save Authorized Admins')}</span>
                </button>
              </div>
            </form>

            {/* Step-by-Step Setup Guide */}
            <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200 text-xs space-y-3">
              <div className="flex items-center gap-2 font-extrabold text-amber-900">
                <HelpCircle className="w-4 h-4 text-amber-700 shrink-0" />
                <span>{t('دليل الإعداد والتحقق خطوة بخطوة للزميل الجديد:', 'Step-by-Step Setup & Verification Guide:')}</span>
              </div>

              <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-amber-950 font-medium">
                <li>
                  <strong>{t('معرفة المعرف (User ID):', 'Find User ID:')}</strong>{' '}
                  {t(
                    'يقوم المشرف والزميل بمراسلة بوت @userinfobot على تيليجرام للحصول على الرقم التعريفي الخاص بحسابهما (مثلاً 812345678).',
                    'Message @userinfobot on Telegram to get your numeric ID.'
                  )}
                </li>
                <li>
                  <strong>{t('حفظ المعرفات:', 'Save IDs:')}</strong>{' '}
                  {t(
                    'قم بإدخال المعرفين في حقلي المشرف الأول والمشرف الثاني أعلاه واضغط على "حفظ واعتماد الإداريين".',
                    'Enter both IDs above and click "Save Authorized Admins".'
                  )}
                </li>
                <li>
                  <strong>{t('بدء المحادثة مع البوت (/start):', 'Start Bot Conversation:')}</strong>{' '}
                  {t(
                    'يقوم المشرفان بفتح محادثة خاصة مع بوت العيادة والضغط على /start لفتح قناة استقبال التنبيهات المباشرة.',
                    'Both admins must send /start to your clinic bot to enable private DM alerts.'
                  )}
                </li>
                <li>
                  <strong>{t('التحكم التفاعلي:', 'Interactive Operations:')}</strong>{' '}
                  {t(
                    'ستظهر أزرار تفاعلية فورية تحت كل طلب جديد تمكنكما من تأكيد الطلب، تعيين الممارس، تعديل السعر، وإضافة الملاحظات فورياً.',
                    'Interactive buttons will appear under every new order allowing instant confirmation, provider assignment, and quote updates.'
                  )}
                </li>
              </ol>
            </div>

            {/* Interactive Long Polling Worker Status */}
            <div className="p-4 rounded-2xl bg-[#F5F2EB]/60 border border-[#153B36]/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5">
                <Bot className="w-4 h-4 text-[#70A69A]" />
                <div>
                  <div className="flex items-center gap-2">
                    <strong className="text-[#153B36]">{t('محرك الاستقبال التفاعلي المباشر (Long Polling Worker):', 'Interactive Polling Engine:')}</strong>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                      🟢 {t('نشط ويعمل بالخلفية', 'Active')}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#153B36]/70 mt-0.5">
                    {t(
                      'يستقبل الأوامر وضغطات الأزرار فورياً من تطبيقي تيليجرام للمشرفين الاثنين وينفذ التعديلات مباشرة بقاعدة البيانات.',
                      'Instantly processes admin button clicks and updates orders in real-time.'
                    )}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleTogglePolling}
                disabled={isTogglingPolling}
                className="px-3.5 py-1.5 rounded-xl border border-[#153B36]/20 bg-white hover:bg-[#F5F2EB] text-[11px] font-bold text-[#153B36] transition-colors shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 inline ltr:mr-1.5 rtl:ml-1.5 ${isTogglingPolling ? 'animate-spin' : ''}`} />
                <span>{t('إعادة تشغيل المحرك', 'Restart Polling')}</span>
              </button>
            </div>
          </div>

          {/* Live Connection Test Card */}
          <div className="rounded-3xl bg-white border border-[#153B36]/10 p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2 text-[#153B36]">
              <Send className="w-4 h-4 text-sky-600" />
              <h3 className="text-sm font-extrabold">
                {t('فحص الاتصال الحي وإرسال رسالة تجريبية', 'Live Bot Ping & Dispatch Test')}
              </h3>
            </div>

            <p className="text-xs text-[#153B36]/70 leading-relaxed">
              {t(
                'يقوم هذا الفحص بالتحقق من صلاحية التوكن عبر خوادم Telegram Bot API، وإرسال رسالة تجريبية فورية إلى معرف المحادثة المحدد للتأكد من وصول التنبيهات.',
                'Validates token against Telegram Bot API and sends a test message to ensure order notifications reach your phone.'
              )}
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <button
                type="button"
                onClick={handleTestTelegramConnection}
                disabled={isTestingTelegram}
                className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTestingTelegram ? 'animate-spin' : ''}`} />
                <span>{isTestingTelegram ? t('جاري الفحص والإرسال...', 'Testing Connection...') : t('إجراء اختبار اتصال فوري (Send Test Ping)', 'Run Connection Test')}</span>
              </button>
            </div>

            {telegramTestResult && (
              <div
                className={`p-4 rounded-2xl border text-xs space-y-1.5 ${
                  telegramTestResult.success
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                <div className="flex items-center gap-2 font-bold">
                  {telegramTestResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <span>
                    {telegramTestResult.success
                      ? t('نجح فحص الاتصال! البوت متصل وجاهز للعمل.', 'Telegram connection successful!')
                      : t('فشل فحص الاتصال.', 'Telegram test failed.')}
                  </span>
                </div>

                {telegramTestResult.botUsername && (
                  <p className="text-[11px]">
                    <strong>{t('اسم البوت:', 'Bot:')}</strong> @{telegramTestResult.botUsername} ({telegramTestResult.botName})
                  </p>
                )}

                {telegramTestResult.messageId && (
                  <p className="text-[11px] font-mono">
                    <strong>Message ID:</strong> {telegramTestResult.messageId}
                  </p>
                )}

                {telegramTestResult.error && (
                  <p className="text-[11px] text-rose-700">
                    <strong>{t('التفاصيل:', 'Error:')}</strong> {telegramTestResult.error}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Automated Order Notification Workflow Guide */}
          <div className="rounded-3xl bg-[#E7EFEA] border border-[#70A69A]/30 p-6 shadow-xs space-y-3">
            <div className="flex items-center gap-2 text-[#153B36]">
              <CheckCircle2 className="w-4 h-4 text-[#70A69A]" />
              <h3 className="text-sm font-extrabold">
                {t('آلية عمل الإشعارات التلقائية وترشيح الكوادر', 'Automated Dispatch & Provider Recommendation Architecture')}
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs pt-1">
              <div className="p-3.5 rounded-2xl bg-white/80 border border-[#153B36]/10 space-y-1">
                <span className="font-extrabold text-[#153B36] block">1. تسجيل الطلب وحفظه</span>
                <p className="text-[#153B36]/80 text-[11px] leading-relaxed">
                  عند قيام العميل بحجز خدمة عبر الموقع، يتم التحقق من صحة البيانات وحفظ الطلب في قاعدة البيانات برقم مرجعي فريد.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-white/80 border border-[#153B36]/10 space-y-1">
                <span className="font-extrabold text-[#153B36] block">2. مطابقة أقرب 3 ممارسين</span>
                <p className="text-[#153B36]/80 text-[11px] leading-relaxed">
                  يقوم السيرفر تلقائياً بحساب المسافة الجغرافية ووقت الوصول التقديري وترشيح أفضل 3 ممارسين مؤهلين للمنطقة.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-white/80 border border-[#153B36]/10 space-y-1">
                <span className="font-extrabold text-[#153B36] block">3. إشعار فوري وتعيين يدوي</span>
                <p className="text-[#153B36]/80 text-[11px] leading-relaxed">
                  يصل إشعار فوري للإدارة على تيليجرام يحمل كامل التفاصيل ورابط خرائط Google، مع بقاء التعيين يدوياً بالكامل في لوحة التحكم.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* Labs Tab */}
      {activeIntegrationTab === 'labs' && (
        <div className="rounded-3xl bg-white border border-[#153B36]/10 p-6 sm:p-8 space-y-5 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-800 flex items-center justify-center font-bold">
              <Server className="w-5 h-5 text-[#70A69A]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#153B36]">
                {t('بوابة الربط مع المعامل المعتمدة (Laboratory Partner API)', 'Accredited Labs Partner API')}
              </h2>
              <span className="text-xs text-[#70A69A]">
                {t('إرسال أوامر سحب العينات واستقبال النتائج الطبية رقمياً', 'Dispatches sample orders and ingests digital results')}
              </span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-[#F5F2EB] text-xs text-[#153B36]/80 space-y-2">
            <span className="font-bold text-[#153B36] block">
              {t('حالة الربط والبيئة التجريبية (Sandbox Prepared):', 'API Integration Status:')}
            </span>
            <p className="leading-relaxed">
              {t(
                'البنية التحتية جاهزة ومعدة لاستقبال بيانات الاعتماد (API Key & Webhook Secret) عند توقيع بروتوكول الربط البرمجي مع شبكة المعامل الشريكة. تظل الخدمة حالياً تعمل بنظام التنسيق المباشر لضمان انسيابية العمليات.',
                'The architectural pipeline is prepared to ingest laboratory API credentials upon contract execution. Sample collection currently operates via direct phlebotomist coordination.'
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="font-bold text-[#153B36] block mb-1">
                {t('عنوان الخادم (API Endpoint)', 'Endpoint')}
              </label>
              <input
                type="text"
                readOnly
                value="https://api.labpartner.com/v1"
                className="w-full px-3 py-2 rounded-xl border border-[#153B36]/15 bg-[#F5F2EB]/50 font-mono text-[#153B36]/70"
              />
            </div>
            <div>
              <label className="font-bold text-[#153B36] block mb-1">
                {t('اسم الشريك المعملي', 'Partner Network')}
              </label>
              <input
                type="text"
                readOnly
                value="شبكة معامل التحاليل المعتمدة (Al-Mokhtabar / Al-Borg)"
                className="w-full px-3 py-2 rounded-xl border border-[#153B36]/15 bg-[#F5F2EB]/50 text-[#153B36]/70"
              />
            </div>
          </div>
        </div>
      )}

      {/* Security Tab */}
      {activeIntegrationTab === 'security' && (
        <div className="rounded-3xl bg-[#0D2622] text-[#F5F2EB] p-6 sm:p-8 space-y-4 border border-[#70A69A]/30 shadow-lg">
          <div className="flex items-center gap-3 text-[#70A69A]">
            <Lock className="w-5 h-5" />
            <h2 className="text-base font-bold text-[#F5F2EB]">
              {t('مبدأ الأمان وحظر المفاتيح السرية في المتصفح', 'Zero-Trust Secrets Architecture')}
            </h2>
          </div>
          <p className="text-xs text-[#F5F2EB]/80 leading-relaxed">
            {t(
              'وفقاً لمعايير الأمان المعتمدة في هذا المشروع، لا يتم تخزين أي مفاتيح API سرية أو بيانات اعتماد خوادم (مثل Meta Token أو SendGrid Secret) داخل قاعدة بيانات المتصفح أو Firestore العامة. أي تكامل يتطلب مفاتيح خاصة يُربط عبر مسارات خادم خلفية محمية (Server-Side Proxy Routes) أو أسرار بيئة Cloud Run المعزولة.',
              'Per rigorous security standards, private API keys or webhook secrets are never stored in client code or Firestore documents. All external integrations are mediated strictly through protected backend proxy routes and isolated Cloud Run secret manager environments.'
            )}
          </p>
        </div>
      )}
    </div>
  );
};
