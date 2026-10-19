import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[React Error Boundary caught error]:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[300px] p-6 sm:p-10 my-6 bg-white/90 rounded-3xl border border-rose-200 shadow-md text-center max-w-lg mx-auto flex flex-col items-center justify-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-rose-900">
            حدث خطأ غير متوقع في العرض | Unexpected Display Error
          </h3>
          <p className="text-xs text-rose-700 leading-relaxed max-w-md">
            {this.props.fallbackMessage ||
              this.state.error?.message ||
              'تم اعتراض خطأ مؤقت في واجهة المستخدم. يمكنك إعادة تحميل الصفحة للمتابعة.'}
          </p>
          <button
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#153B36] text-[#F5F2EB] text-xs font-bold shadow-xs hover:bg-[#0D2622] transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>إعادة تحديث الصفحة | Reload Page</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
