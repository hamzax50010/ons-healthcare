import React, { useState, useEffect } from 'react';
import { useData } from '../../../context/DataContext';
import { useLanguage } from '../../../context/LanguageContext';
import {
  Palette,
  Check,
  Save,
  CheckCircle2,
  Eye,
  FileCheck,
  Sun,
  Moon,
  ExternalLink,
  Layers,
  Sparkles,
  ShieldCheck,
  Image as ImageIcon,
  Upload,
  AlertCircle,
  RefreshCw,
  FolderGit2,
  FileText,
  Globe
} from 'lucide-react';
import { OnsLogo, OnsLogoVariant } from '../../../components/common/OnsLogo';

interface LogoCardState {
  file: File | null;
  previewUrl: string | null;
  isUploading: boolean;
  successMessage: string | null;
  errorMessage: string | null;
}

export const MediaBrandingTab: React.FC = () => {
  const { settings, updateSettings } = useData();
  const { t } = useLanguage();

  // Color Tokens State (Persisted in Firestore siteSettings)
  const [primaryColor, setPrimaryColor] = useState(settings.primaryColor || '#153B36');
  const [secondaryColor, setSecondaryColor] = useState(settings.secondaryColor || '#F5F2EB');
  const [accentColor, setAccentColor] = useState(settings.accentColor || '#70A69A');

  const [isSaved, setIsSaved] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [assetTimestamp, setAssetTimestamp] = useState<number>(Date.now());

  // Upload state per variant
  const [colorLogoState, setColorLogoState] = useState<LogoCardState>({
    file: null,
    previewUrl: null,
    isUploading: false,
    successMessage: null,
    errorMessage: null,
  });

  const [reversedLogoState, setReversedLogoState] = useState<LogoCardState>({
    file: null,
    previewUrl: null,
    isUploading: false,
    successMessage: null,
    errorMessage: null,
  });

  const [symbolLogoState, setSymbolLogoState] = useState<LogoCardState>({
    file: null,
    previewUrl: null,
    isUploading: false,
    successMessage: null,
    errorMessage: null,
  });

  const [faviconState, setFaviconState] = useState<LogoCardState>({
    file: null,
    previewUrl: null,
    isUploading: false,
    successMessage: null,
    errorMessage: null,
  });

  // State to toggle repository commit helper info
  const [showGitInfo, setShowGitInfo] = useState(false);

  // Helper to handle local file selection & validation
  const handleFileSelect = (
    e: React.ChangeEvent<HTMLInputElement>,
    variant: 'color' | 'reversed' | 'symbol' | 'favicon'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate format
    const allowedTypes = ['image/svg+xml', 'image/png', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'];
    const validExts = ['.svg', '.png', '.webp', '.ico'];
    const hasValidExt = validExts.some((ext) => file.name.toLowerCase().endsWith(ext));

    if (!allowedTypes.includes(file.type) && !hasValidExt) {
      const errorMsg = t(
        'نوع الملف غير مدعوم! يُرجى اختيار صيغة PNG أو SVG أو WebP أو ICO.',
        'Unsupported file format! Please select PNG, SVG, WebP, or ICO.'
      );
      updateVariantState(variant, { errorMessage: errorMsg, successMessage: null });
      return;
    }

    // Validate size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      const errorMsg = t(
        'حجم الملف كبير جداً! الحد الأقصى المسموح به هو 5 ميجابايت.',
        'File size too large! Maximum limit is 5MB.'
      );
      updateVariantState(variant, { errorMessage: errorMsg, successMessage: null });
      return;
    }

    // Generate local preview URL
    const objectUrl = URL.createObjectURL(file);
    updateVariantState(variant, {
      file,
      previewUrl: objectUrl,
      errorMessage: null,
      successMessage: null,
    });
  };

  const updateVariantState = (
    variant: 'color' | 'reversed' | 'symbol' | 'favicon',
    patch: Partial<LogoCardState>
  ) => {
    if (variant === 'color') {
      setColorLogoState((prev) => ({ ...prev, ...patch }));
    } else if (variant === 'reversed') {
      setReversedLogoState((prev) => ({ ...prev, ...patch }));
    } else if (variant === 'symbol') {
      setSymbolLogoState((prev) => ({ ...prev, ...patch }));
    } else {
      setFaviconState((prev) => ({ ...prev, ...patch }));
    }
  };

  // Upload file to server endpoint which writes directly to /public/assets/branding/ on disk & updates Firestore
  const handleUploadStaticAsset = async (variant: 'color' | 'reversed' | 'symbol' | 'favicon') => {
    const state =
      variant === 'color'
        ? colorLogoState
        : variant === 'reversed'
        ? reversedLogoState
        : variant === 'symbol'
        ? symbolLogoState
        : faviconState;

    if (!state.file) return;

    updateVariantState(variant, { isUploading: true, errorMessage: null, successMessage: null });

    try {
      // Convert file to base64
      const reader = new FileReader();

      const fileDataPromise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(state.file!);
      });

      const fileData = await fileDataPromise;

      const response = await fetch('/api/branding/upload-logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variant,
          fileData,
          mimeType: state.file.type,
          filename: state.file.name,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to write file to project static assets directory.');
      }

      const savedPath = result.filePath; // e.g. /assets/branding/favicon.png

      // Persist in Firestore siteSettings
      if (variant === 'color') {
        await updateSettings({ logoUrl: savedPath });
      } else if (variant === 'reversed') {
        await updateSettings({ darkLogoUrl: savedPath });
      } else if (variant === 'symbol') {
        await updateSettings({ symbolUrl: savedPath });
      } else if (variant === 'favicon') {
        await updateSettings({ symbolUrl: savedPath });
      }

      // Directly update document head favicon if favicon or symbol
      if (variant === 'favicon' || variant === 'symbol') {
        const head = document.head || document.getElementsByTagName('head')[0];
        const timestamped = `${savedPath}?v=${Date.now()}`;
        const icons = head.querySelectorAll<HTMLLinkElement>("link[rel*='icon']");
        if (icons.length > 0) {
          icons.forEach((ic) => {
            ic.href = timestamped;
            if (savedPath.endsWith('.svg')) ic.type = 'image/svg+xml';
            else if (savedPath.endsWith('.ico')) ic.type = 'image/x-icon';
            else ic.type = 'image/png';
          });
        }
      }

      const now = Date.now();
      setAssetTimestamp(now);

      updateVariantState(variant, {
        isUploading: false,
        file: null,
        previewUrl: null,
        successMessage: t(
          `تم حفظ وديمومة الملف بنجاح كأصل ثابت في المشروع (${savedPath}) وتم تحديث قاعدة البيانات!`,
          `Asset saved & persisted successfully in project static files (${savedPath}) and synced to database!`
        ),
        errorMessage: null,
      });

      setUploadNotice(
        t(
          `تم تحديث أصل الهوية (${variant}) بنجاح كملف ثابت (${savedPath}) وحفظه في الإعدادات!`,
          `Static asset (${variant}) updated successfully at ${savedPath} and persisted in settings!`
        )
      );

      setTimeout(() => setUploadNotice(null), 4000);
    } catch (err: any) {
      updateVariantState(variant, {
        isUploading: false,
        errorMessage: err.message || 'فشل رفع وحفظ الأصل إلى الخادم',
      });
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings({
      primaryColor,
      secondaryColor,
      accentColor,
    });
    setIsSaved(true);
    setUploadNotice(
      t(
        'تم حفظ ألوان الهوية البصرية بنجاح وربطها بجميع عناصر الموقع!',
        'Brand color palette saved successfully and synced across all UI components!'
      )
    );
    setTimeout(() => {
      setIsSaved(false);
      setTimeout(() => setUploadNotice(null), 3500);
    }, 2000);
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Tab Header */}
      <div>
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-[#153B36] text-[#70A69A]">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-[#153B36]">
              {t('إدارة الشعار والأصول والأيقونة المفضلة (Favicon)', 'Brand Assets & Favicon Management')}
            </h1>
            <p className="text-xs text-[#153B36]/70 mt-0.5">
              {t(
                'رفع وتثبيت أصول الهوية البصرية والـ Favicon في مجلد أصول المشروع الثابتة (/public/assets/branding/) والحفظ المباشر.',
                'Upload and persist static brand logos & favicon directly in project static directory (/public/assets/branding/).'
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Static Brand Asset Banner */}
      <div className="p-4 rounded-2xl bg-[#153B36]/5 border border-[#153B36]/15 text-[#153B36] text-xs leading-relaxed flex items-start gap-3 shadow-xs">
        <ShieldCheck className="w-5 h-5 text-[#70A69A] shrink-0 mt-0.5" />
        <div className="space-y-1.5 flex-1">
          <div className="flex items-center justify-between">
            <p className="font-bold text-sm">
              {t(
                'تخزين وديمومة أصول الهوية والـ Favicon في أصول المشروع الثابتة (/public/assets/branding/)',
                'Static Asset Persistence Architecture (/public/assets/branding/)'
              )}
            </p>
            <button
              onClick={() => setShowGitInfo(!showGitInfo)}
              className="text-[11px] font-bold text-[#153B36] underline hover:text-[#70A69A] flex items-center gap-1 cursor-pointer"
            >
              <FolderGit2 className="w-3.5 h-3.5" />
              <span>{showGitInfo ? t('إخفاء التفاصيل', 'Hide details') : t('مسارات الملفات المعتمدة', 'Repository info')}</span>
            </button>
          </div>
          <p className="text-[#153B36]/75">
            {t(
              'عند رفع ملف جديد، يتم حفظه مباشرة كملف ثابت حقيقي في مجلد أصول المشروع (/public/assets/branding/) وحفظ مساره المعتمد في قاعدة البيانات. يضمن ذلك بقاء الشعار والـ Favicon حتى بعد إعادة تحميل الصفحة أو التحديث.',
              'Uploaded assets and favicons are saved as real static files in the repository (/public/assets/branding/) and their persistent path is stored in settings. This ensures images remain displayed permanently across reloads and deployments.'
            )}
          </p>

          {showGitInfo && (
            <div className="mt-3 p-3 rounded-xl bg-white border border-[#153B36]/20 space-y-2 text-[11px] animate-fadeIn">
              <div className="font-bold text-[#153B36] flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-[#70A69A]" />
                <span>{t('مسارات الأصول الثابتة المعتمدة في مستودع المشروع:', 'Repository Static Asset Paths:')}</span>
              </div>
              <ul className="space-y-1 font-mono text-[10px] text-gray-700 list-disc list-inside">
                <li><strong className="text-[#153B36]">1. الشعار العام:</strong> <code className="bg-gray-100 px-1 py-0.5 rounded">/assets/branding/ons-logo.png</code></li>
                <li><strong className="text-[#153B36]">2. الشعار الداكن:</strong> <code className="bg-gray-100 px-1 py-0.5 rounded">/assets/branding/ons-logo-reversed.png</code></li>
                <li><strong className="text-[#153B36]">3. الرمز المستقل:</strong> <code className="bg-gray-100 px-1 py-0.5 rounded">/assets/branding/ons-symbol.png</code></li>
                <li><strong className="text-[#153B36]">4. الـ Favicon:</strong> <code className="bg-gray-100 px-1 py-0.5 rounded">/assets/branding/favicon.png</code></li>
              </ul>
            </div>
          )}
        </div>
      </div>

      {uploadNotice && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-900 text-xs font-bold flex items-center gap-2.5 animate-fadeIn shadow-xs">
          <FileCheck className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{uploadNotice}</span>
        </div>
      )}

      {/* RESTORED LOGO & FAVICON UPLOADER CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* 1. Public Site Logo */}
        <div className="rounded-3xl bg-white border border-[#153B36]/15 p-5 space-y-4 shadow-sm flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#153B36]/10">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
                  <Sun className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-xs font-extrabold text-[#153B36]">
                    {t('1. شعار الموقع العام', '1. Public Site Logo')}
                  </h2>
                  <span className="text-[10px] font-mono text-[#70A69A]">/assets/branding/ons-logo.*</span>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-[#153B36]/70 leading-relaxed">
              {t(
                'شعار الهيدر للشرائح الفاتحة (#F5F2EB).',
                'Top Navbar header logo on light background.'
              )}
            </p>

            {/* Preview Box */}
            <div className="rounded-2xl border border-black/10 overflow-hidden bg-gray-50 flex flex-col items-center justify-center p-3 h-28 relative">
              {colorLogoState.previewUrl ? (
                <img src={colorLogoState.previewUrl} alt="Preview" className="h-14 w-auto max-w-full object-contain animate-pulse" />
              ) : (
                <OnsLogo variant="color" src={settings.logoUrl} timestamp={assetTimestamp} className="h-14 w-auto max-w-full" />
              )}
              <span className="text-[9px] font-bold text-[#153B36]/70 mt-1">
                {colorLogoState.previewUrl ? t('معاينة محليّة غير محفوظة', 'Unsaved Preview') : (settings.logoUrl || '/assets/branding/ons-logo.png')}
              </span>
            </div>

            {/* Upload Control */}
            <div className="space-y-2">
              <input
                type="file"
                accept=".png, .svg, .webp, image/png, image/svg+xml, image/webp"
                onChange={(e) => handleFileSelect(e, 'color')}
                id="color-logo-file-input"
                className="hidden"
              />
              <div className="flex items-center gap-2">
                <label
                  htmlFor="color-logo-file-input"
                  className="flex-1 px-3 py-2 rounded-xl border-2 border-dashed border-[#153B36]/30 bg-gray-50 hover:bg-[#153B36]/5 text-[11px] text-[#153B36] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-[#70A69A]" />
                  <span className="truncate">{colorLogoState.file ? colorLogoState.file.name : t('اختيار ملف', 'Select File')}</span>
                </label>

                {colorLogoState.file && (
                  <button
                    onClick={() => handleUploadStaticAsset('color')}
                    disabled={colorLogoState.isUploading}
                    className="px-3 py-2 rounded-xl bg-[#153B36] text-[#F5F2EB] text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {colorLogoState.isUploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#70A69A]" /> : <Save className="w-3.5 h-3.5 text-[#70A69A]" />}
                    <span>{colorLogoState.isUploading ? t('حفظ...', 'Saving...') : t('حفظ', 'Save')}</span>
                  </button>
                )}
              </div>

              {colorLogoState.errorMessage && (
                <p className="text-[10px] text-red-600 font-bold">{colorLogoState.errorMessage}</p>
              )}
              {colorLogoState.successMessage && (
                <p className="text-[10px] text-emerald-700 font-bold">{colorLogoState.successMessage}</p>
              )}
            </div>
          </div>
        </div>

        {/* 2. Dark Background Logo */}
        <div className="rounded-3xl bg-white border border-[#153B36]/15 p-5 space-y-4 shadow-sm flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#153B36]/10">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-[#153B36] text-[#70A69A]">
                  <Moon className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-xs font-extrabold text-[#153B36]">
                    {t('2. الشعار الداكن', '2. Dark Logo')}
                  </h2>
                  <span className="text-[10px] font-mono text-[#70A69A]">/assets/branding/ons-logo-reversed.*</span>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-[#153B36]/70 leading-relaxed">
              {t('شعار الفوتر ولوحة التحكم (#153B36).', 'Footer & Admin dark logo.')}
            </p>

            {/* Preview Box */}
            <div className="rounded-2xl border border-black/10 overflow-hidden bg-[#153B36] flex flex-col items-center justify-center p-3 h-28 relative">
              {reversedLogoState.previewUrl ? (
                <img src={reversedLogoState.previewUrl} alt="Preview" className="h-14 w-auto max-w-full object-contain animate-pulse" />
              ) : (
                <OnsLogo variant="reversed" src={settings.darkLogoUrl} timestamp={assetTimestamp} className="h-14 w-auto max-w-full" />
              )}
              <span className="text-[9px] font-bold text-[#F5F2EB]/70 mt-1">
                {reversedLogoState.previewUrl ? t('معاينة محليّة غير محفوظة', 'Unsaved Preview') : (settings.darkLogoUrl || '/assets/branding/ons-logo-reversed.png')}
              </span>
            </div>

            {/* Upload Control */}
            <div className="space-y-2">
              <input
                type="file"
                accept=".png, .svg, .webp, image/png, image/svg+xml, image/webp"
                onChange={(e) => handleFileSelect(e, 'reversed')}
                id="reversed-logo-file-input"
                className="hidden"
              />
              <div className="flex items-center gap-2">
                <label
                  htmlFor="reversed-logo-file-input"
                  className="flex-1 px-3 py-2 rounded-xl border-2 border-dashed border-[#153B36]/30 bg-gray-50 hover:bg-[#153B36]/5 text-[11px] text-[#153B36] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-[#70A69A]" />
                  <span className="truncate">{reversedLogoState.file ? reversedLogoState.file.name : t('اختيار ملف', 'Select File')}</span>
                </label>

                {reversedLogoState.file && (
                  <button
                    onClick={() => handleUploadStaticAsset('reversed')}
                    disabled={reversedLogoState.isUploading}
                    className="px-3 py-2 rounded-xl bg-[#153B36] text-[#F5F2EB] text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {reversedLogoState.isUploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#70A69A]" /> : <Save className="w-3.5 h-3.5 text-[#70A69A]" />}
                    <span>{reversedLogoState.isUploading ? t('حفظ...', 'Saving...') : t('حفظ', 'Save')}</span>
                  </button>
                )}
              </div>

              {reversedLogoState.errorMessage && (
                <p className="text-[10px] text-red-600 font-bold">{reversedLogoState.errorMessage}</p>
              )}
              {reversedLogoState.successMessage && (
                <p className="text-[10px] text-emerald-700 font-bold">{reversedLogoState.successMessage}</p>
              )}
            </div>
          </div>
        </div>

        {/* 3. Isolated Symbol Mark */}
        <div className="rounded-3xl bg-white border border-[#153B36]/15 p-5 space-y-4 shadow-sm flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#153B36]/10">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-[#70A69A]/20 text-[#153B36]">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-xs font-extrabold text-[#153B36]">
                    {t('3. الرمز المستقل', '3. Symbol Mark')}
                  </h2>
                  <span className="text-[10px] font-mono text-[#70A69A]">/assets/branding/ons-symbol.*</span>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-[#153B36]/70 leading-relaxed">
              {t('رمز أُنس للأزرار والأيقونات المصغرة.', 'Standalone symbol mark for compact UI.')}
            </p>

            {/* Preview Box */}
            <div className="rounded-2xl border border-black/10 overflow-hidden bg-gray-50 flex flex-col items-center justify-center p-3 h-28 relative">
              {symbolLogoState.previewUrl ? (
                <img src={symbolLogoState.previewUrl} alt="Preview" className="h-12 w-auto max-w-full object-contain animate-pulse" />
              ) : (
                <OnsLogo variant="symbol" src={settings.symbolUrl} timestamp={assetTimestamp} className="h-12 w-auto max-w-full" />
              )}
              <span className="text-[9px] font-bold text-[#153B36]/70 mt-1">
                {symbolLogoState.previewUrl ? t('معاينة محليّة غير محفوظة', 'Unsaved Preview') : (settings.symbolUrl || '/assets/branding/ons-symbol.png')}
              </span>
            </div>

            {/* Upload Control */}
            <div className="space-y-2">
              <input
                type="file"
                accept=".png, .svg, .webp, image/png, image/svg+xml, image/webp"
                onChange={(e) => handleFileSelect(e, 'symbol')}
                id="symbol-logo-file-input"
                className="hidden"
              />
              <div className="flex items-center gap-2">
                <label
                  htmlFor="symbol-logo-file-input"
                  className="flex-1 px-3 py-2 rounded-xl border-2 border-dashed border-[#153B36]/30 bg-gray-50 hover:bg-[#153B36]/5 text-[11px] text-[#153B36] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-[#70A69A]" />
                  <span className="truncate">{symbolLogoState.file ? symbolLogoState.file.name : t('اختيار ملف', 'Select File')}</span>
                </label>

                {symbolLogoState.file && (
                  <button
                    onClick={() => handleUploadStaticAsset('symbol')}
                    disabled={symbolLogoState.isUploading}
                    className="px-3 py-2 rounded-xl bg-[#153B36] text-[#F5F2EB] text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {symbolLogoState.isUploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#70A69A]" /> : <Save className="w-3.5 h-3.5 text-[#70A69A]" />}
                    <span>{symbolLogoState.isUploading ? t('حفظ...', 'Saving...') : t('حفظ', 'Save')}</span>
                  </button>
                )}
              </div>

              {symbolLogoState.errorMessage && (
                <p className="text-[10px] text-red-600 font-bold">{symbolLogoState.errorMessage}</p>
              )}
              {symbolLogoState.successMessage && (
                <p className="text-[10px] text-emerald-700 font-bold">{symbolLogoState.successMessage}</p>
              )}
            </div>
          </div>
        </div>

        {/* 4. Website Favicon */}
        <div className="rounded-3xl bg-white border border-[#153B36]/15 p-5 space-y-4 shadow-sm flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#153B36]/10">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-teal-50 text-teal-700 border border-teal-200">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-xs font-extrabold text-[#153B36]">
                    {t('4. أيقونة المتصفح (Favicon)', '4. Website Favicon')}
                  </h2>
                  <span className="text-[10px] font-mono text-[#70A69A]">/assets/branding/favicon.*</span>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-[#153B36]/70 leading-relaxed">
              {t('أيقونة تبويب المتصفح والقوائم المرجعية.', 'Browser tab icon & bookmark badge.')}
            </p>

            {/* Preview Box with simulated browser tab */}
            <div className="rounded-2xl border border-black/10 overflow-hidden bg-slate-100 flex flex-col p-2 h-28 justify-between relative">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-xs">
                {faviconState.previewUrl ? (
                  <img src={faviconState.previewUrl} alt="Favicon Preview" className="w-4 h-4 object-contain animate-pulse" />
                ) : (
                  <img
                    src={`${settings.symbolUrl || '/assets/branding/favicon.png'}?t=${assetTimestamp}`}
                    alt="Favicon"
                    className="w-4 h-4 object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/logos/ons-symbol.png';
                    }}
                  />
                )}
                <span className="text-[10px] font-bold text-slate-800 truncate flex-1">
                  أُنس | ONS Healthcare
                </span>
              </div>

              <div className="text-center pt-1">
                <span className="text-[9px] font-bold text-[#153B36]/70 block">
                  {faviconState.previewUrl ? t('معاينة الـ Favicon قبل الحفظ', 'Unsaved Favicon Preview') : (settings.symbolUrl || '/assets/branding/favicon.png')}
                </span>
              </div>
            </div>

            {/* Upload Control */}
            <div className="space-y-2">
              <input
                type="file"
                accept=".png, .svg, .webp, .ico, image/png, image/svg+xml, image/webp, image/x-icon"
                onChange={(e) => handleFileSelect(e, 'favicon')}
                id="favicon-file-input"
                className="hidden"
              />
              <div className="flex items-center gap-2">
                <label
                  htmlFor="favicon-file-input"
                  className="flex-1 px-3 py-2 rounded-xl border-2 border-dashed border-[#153B36]/30 bg-gray-50 hover:bg-[#153B36]/5 text-[11px] text-[#153B36] font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 text-[#70A69A]" />
                  <span className="truncate">{faviconState.file ? faviconState.file.name : t('اختيار أيقونة', 'Select Favicon')}</span>
                </label>

                {faviconState.file && (
                  <button
                    onClick={() => handleUploadStaticAsset('favicon')}
                    disabled={faviconState.isUploading}
                    className="px-3 py-2 rounded-xl bg-[#153B36] text-[#F5F2EB] text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {faviconState.isUploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#70A69A]" /> : <Save className="w-3.5 h-3.5 text-[#70A69A]" />}
                    <span>{faviconState.isUploading ? t('حفظ...', 'Saving...') : t('حفظ الأيقونة', 'Save')}</span>
                  </button>
                )}
              </div>

              {faviconState.errorMessage && (
                <p className="text-[10px] text-red-600 font-bold">{faviconState.errorMessage}</p>
              )}
              {faviconState.successMessage && (
                <p className="text-[10px] text-emerald-700 font-bold">{faviconState.successMessage}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Real-time Placement Simulation */}
      <div className="rounded-3xl bg-white border border-[#153B36]/10 p-6 sm:p-8 space-y-4 shadow-xs">
        <div className="flex items-center justify-between pb-3 border-b border-[#153B36]/10">
          <div className="flex items-center gap-2 font-bold text-sm text-[#153B36]">
            <ExternalLink className="w-4 h-4 text-[#70A69A]" />
            <span>{t('محاكاة حية لموضعي الشعارين وأيقونة المتصفح', 'Live Simulation of Logo & Favicon Placements')}</span>
          </div>
          <span className="text-[11px] text-[#153B36]/60 font-medium">
            {t('عرض أصول المشروع الثابتة الحية', 'Live static project asset rendering')}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Simulated Navbar Banner */}
          <div className="rounded-2xl border border-[#153B36]/15 bg-[#F5F2EB] p-4 flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between border-b border-[#153B36]/10 pb-3">
              <div className="flex items-center gap-3">
                <OnsLogo variant="color" src={settings.logoUrl} timestamp={assetTimestamp} className="h-10 w-auto" />
                <span className="text-xs font-extrabold text-[#153B36]">أُنس للرعاية الصحية</span>
              </div>
              <span className="px-2 py-0.5 rounded-md bg-white border border-[#153B36]/15 text-[10px] font-bold text-[#153B36]">
                Navbar (الهيدر)
              </span>
            </div>
            <p className="text-[11px] text-[#153B36]/70 leading-relaxed">
              {t('هكذا يظهر شعار الموقع العام لجميع زوار موقع أُنس في أعلى كافة الصفحات.', 'This is how the public logo appears to all visitors in the top header.')}
            </p>
          </div>

          {/* Simulated Footer Banner */}
          <div className="rounded-2xl border border-[#153B36]/15 bg-[#153B36] text-[#F5F2EB] p-4 flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-3">
                <OnsLogo variant="reversed" src={settings.darkLogoUrl} timestamp={assetTimestamp} className="h-10 w-auto" />
                <span className="text-xs font-extrabold text-[#F5F2EB]">أُنس للرعاية الصحية</span>
              </div>
              <span className="px-2 py-0.5 rounded-md bg-white/10 border border-white/20 text-[10px] font-bold text-[#F5F2EB]">
                Footer (الفوتر)
              </span>
            </div>
            <p className="text-[11px] text-[#F5F2EB]/70 leading-relaxed">
              {t('هكذا يظهر شعار الخلفية الداكنة في ذيل الموقع ولوحة التحكم بأعلى وضوح وتباين.', 'This is how the dark logo appears in the dark footer and admin bars with maximum contrast.')}
            </p>
          </div>
        </div>
      </div>

      {/* Brand Color Tokens & Final Save Form */}
      <form onSubmit={handleSaveBranding} className="space-y-6">
        <div className="rounded-3xl bg-white border border-[#153B36]/10 p-6 sm:p-8 space-y-6 shadow-xs">
          <h2 className="text-base font-bold text-[#153B36] flex items-center gap-2">
            <Palette className="w-5 h-5 text-[#70A69A]" />
            <span>{t('ألوان الهوية المعتمدة في النظام', 'Approved Brand Color Codes')}</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-xs">
            {/* Deep Teal */}
            <div className="p-4 rounded-2xl border border-[#153B36]/10 space-y-3 bg-[#F5F2EB]/40">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#153B36]">
                  {t('اللون الأساسي (أخضر داكن)', 'Primary Dark Color')}
                </span>
                <span className="font-mono text-[11px] font-bold">{primaryColor}</span>
              </div>
              <div
                className="w-full h-12 rounded-xl border border-black/10 shadow-inner"
                style={{ backgroundColor: primaryColor }}
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-full bg-white border border-[#153B36]/20 rounded-xl px-3 py-1.5 font-mono text-xs text-[#153B36]"
              />
            </div>

            {/* Soft Teal */}
            <div className="p-4 rounded-2xl border border-[#153B36]/10 space-y-3 bg-[#F5F2EB]/40">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#153B36]">
                  {t('اللون الثانوي (أخضر مائي)', 'Accent Teal Color')}
                </span>
                <span className="font-mono text-[11px] font-bold">{accentColor}</span>
              </div>
              <div
                className="w-full h-12 rounded-xl border border-black/10 shadow-inner"
                style={{ backgroundColor: accentColor }}
              />
              <input
                type="text"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                className="w-full bg-white border border-[#153B36]/20 rounded-xl px-3 py-1.5 font-mono text-xs text-[#153B36]"
              />
            </div>

            {/* Warm Ivory */}
            <div className="p-4 rounded-2xl border border-[#153B36]/10 space-y-3 bg-[#F5F2EB]/40">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#153B36]">
                  {t('العاجي الدافئ (الخلفية)', 'Warm Ivory (Background)')}
                </span>
                <span className="font-mono text-[11px] font-bold">{secondaryColor}</span>
              </div>
              <div
                className="w-full h-12 rounded-xl border border-black/10 shadow-inner"
                style={{ backgroundColor: secondaryColor }}
              />
              <input
                type="text"
                value={secondaryColor}
                onChange={(e) => setSecondaryColor(e.target.value)}
                className="w-full bg-white border border-[#153B36]/20 rounded-xl px-3 py-1.5 font-mono text-xs text-[#153B36]"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-[#153B36]/10 flex flex-col sm:flex-row items-center justify-between gap-4">
            <span className="text-xs text-[#153B36]/70">
              {t(
                'يتم حفظ خيارات ألوان الهوية ومزامنتها في قاعدة البيانات فور الضغط على زر الحفظ.',
                'Brand color settings sync to database upon saving.'
              )}
            </span>
            <button
              type="submit"
              className="px-8 py-3 rounded-xl bg-[#153B36] text-[#F5F2EB] text-xs font-bold hover:bg-[#0D2622] transition-colors flex items-center gap-2 shadow-md active:scale-98 cursor-pointer"
            >
              {isSaved ? <Check className="w-4 h-4 text-emerald-400" /> : <Save className="w-4 h-4 text-[#70A69A]" />}
              <span>{isSaved ? t('تم الحفظ بنجاح', 'Saved') : t('حفظ خيارات ألوان الهوية البصرية', 'Save Visual Identity Colors')}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
