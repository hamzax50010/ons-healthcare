import React, { useState, useEffect } from 'react';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider, useData } from './context/DataContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';

// Public Components
import { AnnouncementBar } from './components/public/AnnouncementBar';
import { Navbar } from './components/public/Navbar';
import { Footer } from './components/public/Footer';

// Public Pages
import { HomePage } from './pages/public/HomePage';
import { ServicesPage } from './pages/public/ServicesPage';
import { ServiceDetailPage } from './pages/public/ServiceDetailPage';
import { RequestServicePage } from './pages/public/RequestServicePage';
import { AboutPage } from './pages/public/AboutPage';
import { ContactPage } from './pages/public/ContactPage';
import { ReviewsPage } from './pages/public/ReviewsPage';
import { LeaveReviewPage } from './pages/public/LeaveReviewPage';
import { PrivacyPolicyPage } from './pages/public/PrivacyPolicyPage';

// Admin Pages
import { AdminLogin } from './pages/admin/AdminLogin';
import { AdminLayout } from './pages/admin/AdminLayout';
import { AlertCircle, RefreshCw } from 'lucide-react';

function AppContent() {
  const { isOwner } = useAuth();
  const { settings, isLoading, isError, errorMessage, retryConnection } = useData();
  const { t } = useLanguage();

  // Dynamically synchronize browser favicon with uploaded static asset
  useEffect(() => {
    const targetFavicon = settings?.symbolUrl || settings?.logoUrl || '/assets/branding/favicon.png';
    if (!targetFavicon) return;

    try {
      const head = document.head || document.getElementsByTagName('head')[0];
      const isSvg = targetFavicon.toLowerCase().includes('.svg');
      const isIco = targetFavicon.toLowerCase().includes('.ico');
      const mimeType = isSvg ? 'image/svg+xml' : isIco ? 'image/x-icon' : 'image/png';
      
      // Ensure absolute relative URL with cache bust if not already query stringed
      const cleanUrl = targetFavicon.split('?')[0];
      const timestampedUrl = `${cleanUrl}?v=${Date.now()}`;

      const iconLinks = head.querySelectorAll<HTMLLinkElement>("link[rel*='icon']");
      if (iconLinks.length > 0) {
        iconLinks.forEach((link) => {
          link.href = timestampedUrl;
          link.type = mimeType;
        });
      } else {
        const link = document.createElement('link');
        link.rel = 'icon';
        link.type = mimeType;
        link.href = timestampedUrl;
        head.appendChild(link);
      }

      const appleIcon = head.querySelector<HTMLLinkElement>("link[rel='apple-touch-icon']");
      if (appleIcon) {
        appleIcon.href = timestampedUrl;
      }
    } catch (err) {
      console.warn('[App Favicon Sync Error]', err);
    }
  }, [settings?.symbolUrl, settings?.logoUrl]);

  // Determine initial route from URL
  const [currentRoute, setCurrentRoute] = useState<string>(() => {
    const path = window.location.pathname;
    const hash = window.location.hash;
    const searchParams = new URLSearchParams(window.location.search);
    const queryRoute = searchParams.get('route');

    if (queryRoute) return queryRoute;
    if (path === '/admin' || hash === '#admin') return 'admin';
    if (path === '/leave-review' || path === '/rate' || path === '/review' || hash === '#review') {
      return 'leave-review';
    }
    const cleanPath = path.replace(/^\//, '');
    return cleanPath || 'home';
  });

  const [routeParams, setRouteParams] = useState<any>(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const serviceId = searchParams.get('serviceId') || searchParams.get('id');
    return serviceId ? { serviceId, id: serviceId } : {};
  });

  // Sync with browser back/forward and hash
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      const hash = window.location.hash;
      const searchParams = new URLSearchParams(window.location.search);
      const queryRoute = searchParams.get('route');
      const serviceId = searchParams.get('serviceId') || searchParams.get('id');

      if (serviceId) {
        setRouteParams((prev: any) => ({ ...prev, serviceId, id: serviceId }));
      }

      if (queryRoute) {
        setCurrentRoute(queryRoute);
      } else if (path === '/admin' || hash === '#admin') {
        setCurrentRoute('admin');
      } else if (path === '/leave-review' || path === '/rate' || path === '/review' || hash === '#review') {
        setCurrentRoute('leave-review');
      } else {
        const cleanPath = path.replace(/^\//, '');
        setCurrentRoute(cleanPath || 'home');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (route: string, params: any = {}) => {
    setRouteParams(params);
    setCurrentRoute(route);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    let targetUrl = route === 'home' ? '/' : `/${route}`;
    const sid = params.serviceId || params.id;
    if (sid) {
      targetUrl += `?serviceId=${encodeURIComponent(sid)}`;
    }

    if (route === 'admin') {
      window.history.pushState({}, '', '/admin');
    } else {
      window.history.pushState({}, '', targetUrl);
    }
  };

  // Render loading state while Firestore initializes
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F5F2EB] flex items-center justify-center p-4 text-[#153B36]">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-[#153B36] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-bold">{t('جاري جلب البيانات من قاعدة بيانات Cloud Firestore...', 'Loading content from Cloud Firestore...')}</p>
        </div>
      </div>
    );
  }

  // Render error state if Firestore fails or connection is blocked
  if (isError) {
    return (
      <div className="min-h-screen bg-[#F5F2EB] flex items-center justify-center p-4 text-[#153B36]">
        <div className="bg-white max-w-md w-full p-8 rounded-3xl border border-rose-200 shadow-xl text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-rose-600 mx-auto" />
          <h2 className="text-xl font-extrabold text-rose-900">{t('فشل الاتصال بقاعدة البيانات', 'Database Connection Failed')}</h2>
          <p className="text-xs text-rose-800 leading-relaxed">{errorMessage}</p>
          <button
            onClick={retryConnection}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#153B36] hover:bg-[#0D2622] text-[#F5F2EB] text-xs font-bold shadow-md transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>{t('إعادة المحاولة', 'Retry Connection')}</span>
          </button>
        </div>
      </div>
    );
  }

  // 1. Separate Private Administrative Dashboard Route (/admin)
  if (currentRoute === 'admin') {
    if (!isOwner) {
      return <AdminLogin onBackToPublic={() => navigate('home')} />;
    }
    return (
      <ErrorBoundary fallbackMessage="حدث خطأ أثناء عرض لوحة التحكم الإدارية. يرجى التحديث.">
        <AdminLayout onBackToPublic={() => navigate('home')} />
      </ErrorBoundary>
    );
  }

  // 2. Public Facing Website Experience
  return (
    <div className="min-h-screen flex flex-col bg-[#F5F2EB] text-[#153B36] selection:bg-[#70A69A]/30 selection:text-[#153B36] overflow-x-hidden">
      <AnnouncementBar />
      <Navbar currentRoute={currentRoute} navigate={navigate} />

      <main className="flex-1">
        <ErrorBoundary>
          {currentRoute === 'home' && <HomePage navigate={navigate} />}
          {currentRoute === 'services' && <ServicesPage navigate={navigate} />}
          {currentRoute === 'service-detail' && (
            <ServiceDetailPage serviceId={routeParams.id || routeParams.serviceId} navigate={navigate} />
          )}
          {currentRoute === 'request' && (
            <RequestServicePage
              initialServiceId={routeParams.serviceId || routeParams.id}
              navigate={navigate}
            />
          )}
          {currentRoute === 'about' && <AboutPage navigate={navigate} />}
          {currentRoute === 'contact' && <ContactPage navigate={navigate} />}
          {currentRoute === 'reviews' && <ReviewsPage navigate={navigate} />}
          {(currentRoute === 'leave-review' || currentRoute === 'rate' || currentRoute === 'review') && (
            <LeaveReviewPage navigate={navigate} />
          )}
          {currentRoute === 'privacy' && <PrivacyPolicyPage />}
        </ErrorBoundary>
      </main>

      <Footer navigate={navigate} />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <AuthProvider>
          <DataProvider>
            <AppContent />
          </DataProvider>
        </AuthProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}
