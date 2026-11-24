import React from 'react';
import {
  Bike,
  Briefcase,
  CalendarDays,
  Heart,
  Home,
  Lightbulb,
  Plus,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { useApp, type NavSection } from '../context/AppContext';
import { ROUTINE_MODE_LABELS } from '../types/domain';
import { RemindersMenu } from './RemindersMenu';

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'dashboard', label: 'Hoje', icon: Home },
  { id: 'calendar', label: 'Calendário', icon: CalendarDays },
  { id: 'finance', label: 'Financeiro', icon: Wallet },
  { id: 'work', label: 'Trabalho', icon: Bike },
  { id: 'health', label: 'Saúde', icon: Heart },
  { id: 'family', label: 'Família', icon: Users },
  { id: 'career', label: 'Estudos & TI', icon: Briefcase },
  { id: 'ideas', label: 'Ideias & Revisão', icon: Lightbulb },
  { id: 'settings', label: 'Configurações', icon: SettingsIcon },
];

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    db,
    settings,
    activeSection,
    setActiveSection,
    openQuickAction,
    toasts,
  } = useApp();

  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/90">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 font-bold text-white shadow">
              LH
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight">LifeHub</h1>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Central de Vida</p>
            </div>
          </div>

          {settings && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center rounded-md bg-brand-500/15 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:text-brand-400">
                Modo: {ROUTINE_MODE_LABELS[settings.routine_mode]}
              </span>
              {settings.demo_data_loaded === 1 && (
                <span className="inline-flex items-center rounded-md bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  Dados Demo
                </span>
              )}
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1 p-3" aria-label="Navegação principal">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3 dark:border-slate-800">
          <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-600 dark:bg-slate-800/80 dark:text-slate-400">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
            <div>
              <p className="font-medium text-slate-700 dark:text-slate-200">100% Local-First</p>
              <p>
                {db?.driverName === 'tauri-sqlite'
                  ? 'SQLite nativo (Tauri)'
                  : 'SQLite local (Offline)'}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Quick actions bar */}
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white/90 px-6 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Atalhos rápidos:
            </span>
            <button
              type="button"
              onClick={() => openQuickAction('transaction')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 transition hover:border-brand-500 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-brand-400"
            >
              <Plus className="h-3.5 w-3.5" /> Transação
            </button>
            <button
              type="button"
              onClick={() => openQuickAction('work_session')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 transition hover:border-brand-500 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-brand-400"
            >
              <Plus className="h-3.5 w-3.5" /> Jornada Uber/99
            </button>
            <button
              type="button"
              onClick={() => openQuickAction('event')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 transition hover:border-brand-500 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-brand-400"
            >
              <Plus className="h-3.5 w-3.5" /> Compromisso
            </button>
            <button
              type="button"
              onClick={() => openQuickAction('task')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 transition hover:border-brand-500 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-brand-400"
            >
              <Plus className="h-3.5 w-3.5" /> Tarefa
            </button>
            <button
              type="button"
              onClick={() => openQuickAction('idea')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 transition hover:border-brand-500 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-brand-400"
            >
              <Plus className="h-3.5 w-3.5" /> Ideia
            </button>
          </div>
          <RemindersMenu />
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 p-6">{children}</main>
      </div>

      {/* Toast notifications */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg ${
              t.kind === 'error'
                ? 'bg-rose-600 text-white'
                : t.kind === 'info'
                  ? 'bg-slate-800 text-white'
                  : 'bg-emerald-600 text-white'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
};
