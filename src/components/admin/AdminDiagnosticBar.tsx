import React, { useState, useEffect } from 'react';
import { auth, db } from '../../config/firebase';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { ShieldCheck, ShieldAlert, RefreshCw, KeyRound, Database, CheckCircle2, XCircle } from 'lucide-react';

export const AdminDiagnosticBar: React.FC = () => {
  const [testing, setTesting] = useState<boolean>(false);
  const [lastTestedAt, setLastTestedAt] = useState<string | null>(null);
  
  // Auth state
  const currentUser = auth?.currentUser;
  const isAuthenticated = Boolean(currentUser);
  const currentEmail = currentUser?.email || 'غير مسجل بـ Firebase Auth (Unauthenticated)';
  const isOwnerEmailMatch = (currentUser?.email || '').toLowerCase().trim() === 'hamzadiab500@gmail.com';

  // Read results
  const [servicesResult, setServicesResult] = useState<{
    status: 'pending' | 'success' | 'error';
    count: number;
    error: string | null;
  }>({ status: 'pending', count: 0, error: null });

  const [requestsResult, setRequestsResult] = useState<{
    status: 'pending' | 'success' | 'error';
    count: number;
    error: string | null;
  }>({ status: 'pending', count: 0, error: null });

  const runLiveDiagnostics = async () => {
    setTesting(true);
    setServicesResult({ status: 'pending', count: 0, error: null });
    setRequestsResult({ status: 'pending', count: 0, error: null });

    // Test 1: Query services collection
    try {
      const srvSnap = await getDocs(query(collection(db, 'services'), limit(100)));
      setServicesResult({ status: 'success', count: srvSnap.size, error: null });
    } catch (err: any) {
      setServicesResult({ status: 'error', count: 0, error: err.message || String(err) });
    }

    // Test 2: Query customerRequests collection
    try {
      const reqSnap = await getDocs(query(collection(db, 'customerRequests'), limit(100)));
      setRequestsResult({ status: 'success', count: reqSnap.size, error: null });
    } catch (err: any) {
      setRequestsResult({ status: 'error', count: 0, error: err.message || String(err) });
    }

    setLastTestedAt(new Date().toLocaleTimeString('ar-EG'));
    setTesting(false);
  };

  useEffect(() => {
    runLiveDiagnostics();
    const unsub = auth?.onAuthStateChanged(() => {
      runLiveDiagnostics();
    });
    return () => unsub?.();
  }, []);

  return (
    <div className="bg-[#153B36] border-b border-[#70A69A]/30 text-[#F5F2EB] px-4 py-3 text-xs shadow-inner">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Auth & Target Status */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0D2622] border border-[#70A69A]/30 font-mono">
            <KeyRound className="w-3.5 h-3.5 text-[#70A69A]" />
            <span className="text-[#70A69A] font-bold">Auth User:</span>
            <span className={isAuthenticated ? 'text-emerald-300 font-bold' : 'text-amber-300 font-medium'}>
              {currentEmail}
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0D2622] border border-[#70A69A]/30 font-mono">
            <Database className="w-3.5 h-3.5 text-[#70A69A]" />
            <span className="text-[#70A69A] font-bold">Target Project:</span>
            <span className="text-[#F5F2EB] font-bold">ons-healthcar</span>
            <span className="text-xs text-white/50">(default)</span>
          </div>

          <div className="flex items-center gap-1">
            {isOwnerEmailMatch ? (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                <span>المالك المعتمد (Owner Verified)</span>
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1">
                <ShieldAlert className="w-3 h-3" />
                <span>جلسة محاكاة / غير مسجل بـ Auth</span>
              </span>
            )}
          </div>
        </div>

        {/* Live Firestore Query Results */}
        <div className="flex items-center gap-2">
          {/* Services Result */}
          <div className="px-2.5 py-1 rounded-lg bg-[#0D2622] border border-white/10 flex items-center gap-1.5 font-mono text-[11px]">
            <span>services:</span>
            {servicesResult.status === 'pending' && <span className="text-amber-400">جاري الاستعلام...</span>}
            {servicesResult.status === 'success' && (
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> {servicesResult.count} docs
              </span>
            )}
            {servicesResult.status === 'error' && (
              <span className="text-red-400 font-bold flex items-center gap-1" title={servicesResult.error || ''}>
                <XCircle className="w-3 h-3" /> Error
              </span>
            )}
          </div>

          {/* Requests Result */}
          <div className="px-2.5 py-1 rounded-lg bg-[#0D2622] border border-white/10 flex items-center gap-1.5 font-mono text-[11px]">
            <span>customerRequests:</span>
            {requestsResult.status === 'pending' && <span className="text-amber-400">جاري الاستعلام...</span>}
            {requestsResult.status === 'success' && (
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> {requestsResult.count} docs
              </span>
            )}
            {requestsResult.status === 'error' && (
              <span className="text-red-400 font-bold flex items-center gap-1" title={requestsResult.error || ''}>
                <XCircle className="w-3 h-3" /> Error
              </span>
            )}
          </div>

          {/* Refresh Action */}
          <button
            onClick={runLiveDiagnostics}
            disabled={testing}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[#F5F2EB] transition-colors active:scale-95 disabled:opacity-50"
            title="إعادة الفحص المباشر لقاعدة البيانات"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin text-[#70A69A]' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error Details Notice if failed */}
      {(servicesResult.error || requestsResult.error) && (
        <div className="max-w-7xl mx-auto mt-2 p-2 rounded-lg bg-red-950/80 border border-red-800/80 text-[11px] text-red-200 font-mono space-y-0.5">
          {servicesResult.error && <div>[services Error]: {servicesResult.error}</div>}
          {requestsResult.error && <div>[customerRequests Error]: {requestsResult.error}</div>}
        </div>
      )}
    </div>
  );
};
