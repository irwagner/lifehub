import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Ocorreu um erro inesperado na interface.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
          <div className="max-w-md rounded-2xl border border-rose-500/40 bg-slate-900 p-6 shadow-2xl">
            <h1 className="text-lg font-bold text-rose-400">Erro inesperado na interface</h1>
            <p className="mt-2 text-sm text-slate-300">
              Seus dados locais no SQLite continuam preservados. Detalhe técnico:{' '}
              <code className="text-xs text-rose-300">{this.state.message}</code>
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
            >
              Recarregar LifeHub
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
