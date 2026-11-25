import React, { useEffect, useState } from 'react';
import {
  Bike,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Heart,
  Home,
  Lightbulb,
  Menu,
  Moon,
  Plus,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useApp, type NavSection, type QuickActionType } from '../context/AppContext';
import { ROUTINE_MODE_LABELS } from '../types/domain';
import { GlobalSearchModal } from './GlobalSearchModal';
import { RemindersMenu } from './RemindersMenu';
import { SkinSwitcher } from './SkinSwitcher';

interface NavGroup {
  label: string;
  items: Array<{ id: NavSection; label: string; icon: React.FC<{ className?: string }> }>;
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Principal',
    items: [
      { id: 'dashboard', label: 'Hoje', icon: Home },
      { id: 'calendar', label: 'Calendário', icon: CalendarDays },
    ],
  },
  {
    label: 'Dinheiro & Renda',
    items: [
      { id: 'finance', label: 'Financeiro', icon: Wallet },
      { id: 'work', label: 'Trabalho', icon: Bike },
    ],
  },
  {
    label: 'Vida & Evolução',
    items: [
      { id: 'health', label: 'Saúde', icon: Heart },
      { id: 'family', label: 'Família', icon: Users },
      { id: 'career', label: 'Estudos & TI', icon: Briefcase },
      { id: 'ideas', label: 'Ideias & Revisão', icon: Lightbulb },
    ],
  },
  {
    label: 'Sistema',
    items: [{ id: 'settings', label: 'Configurações', icon: SettingsIcon }],
  },
];

const QUICK_PILLS: Array<{
  action: Exclude<QuickActionType, null>;
  label: string;
  shortcut: string;
  dotColor: string;
}> = [
  { action: 'transaction', label: 'Transação', shortcut: 'Alt+T', dotColor: 'bg-emerald-400' },
  { action: 'work_session', label: 'Jornada', shortcut: 'Alt+J', dotColor: 'bg-indigo-400' },
  { action: 'event', label: 'Evento', shortcut: 'Alt+C', dotColor: 'bg-sky-400' },
  { action: 'task', label: 'Tarefa', shortcut: 'Alt+K', dotColor: 'bg-amber-400' },
  { action: 'idea', label: 'Ideia', shortcut: 'Alt+I', dotColor: 'bg-pink-400' },
];

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    db,
    settings,
    patchSettings,
    activeSection,
    setActiveSection,
    openQuickAction,
    toasts,
  } = useApp();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
        return;
      }

      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 't') {
        e.preventDefault();
        openQuickAction('transaction');
      } else if (key === 'j') {
        e.preventDefault();
        openQuickAction('work_session');
      } else if (key === 'c') {
        e.preventDefault();
        openQuickAction('event');
      } else if (key === 'k') {
        e.preventDefault();
        openQuickAction('task');
      } else if (key === 'i') {
        e.preventDefault();
        openQuickAction('idea');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openQuickAction]);

  const handleSelectNav = (id: NavSection) => {
    setActiveSection(id);
    setSidebarOpen(false);
  };

  const toggleTheme = async () => {
    if (!settings) return;
    await patchSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' });
  };

  return (
    <div className="flex min-h-screen text-slate-900 dark:text-slate-100">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`lh-sidebar fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r backdrop-blur-xl transition-transform duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <button
            type="button"
            onClick={() => handleSelectNav('dashboard')}
            className="flex items-center gap-3 text-left"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 via-brand-600 to-indigo-700 text-white shadow-glow">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="8" className="opacity-40" />
                <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                LifeHub
              </h1>
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Central de Vida
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/[0.06] lg:hidden"
            aria-label="Fechar menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode & Demo pills */}
        {settings && (
          <div className="mx-4 mb-3 rounded-xl border border-slate-200/80 bg-slate-50/80 p-2.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Modo ativo
              </span>
              {settings.demo_data_loaded === 1 && (
                <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-300">
                  Demo
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs font-semibold text-brand-600 dark:text-brand-300">
              {ROUTINE_MODE_LABELS[settings.routine_mode]} · {settings.work_days_per_week}d/sem
            </p>
          </div>
        )}

        {/* Grouped Navigation */}
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2" aria-label="Navegação principal">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectNav(item.id)}
                      className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all ${
                        active
                          ? 'bg-brand-600/12 text-brand-700 dark:bg-brand-500/15 dark:text-white'
                          : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.04] dark:hover:text-slate-100'
                      }`}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-500" />
                      )}
                      <Icon
                        className={`h-4 w-4 shrink-0 transition-colors ${
                          active
                            ? 'text-brand-600 dark:text-brand-400'
                            : 'text-slate-400 group-hover:text-slate-700 dark:text-slate-500 dark:group-hover:text-slate-200'
                        }`}
                      />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Local-first status badge */}
        <div className="border-t border-slate-200/70 p-3 dark:border-white/[0.06]">
          <div className="flex items-center gap-2.5 rounded-xl bg-emerald-500/[0.08] px-3 py-2.5 text-[11px] ring-1 ring-emerald-500/20">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
            <div className="min-w-0">
              <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                100% Local-First
              </p>
              <p className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                {db?.driverName === 'tauri-sqlite'
                  ? 'SQLite nativo no dispositivo'
                  : 'SQLite local (Offline)'}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="lh-topbar sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="mr-1 rounded-xl border border-slate-200 p-2 text-slate-700 dark:border-white/[0.09] dark:text-slate-200 lg:hidden"
              aria-label="Abrir menu"
            >
              <Menu className="h-4 w-4" />
            </button>

            {QUICK_PILLS.map((pill) => (
              <button
                key={pill.action}
                type="button"
                onClick={() => openQuickAction(pill.action)}
                title={`Novo: ${pill.label} (${pill.shortcut})`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:-translate-y-[0.5px] hover:border-brand-400/60 hover:text-brand-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200 dark:hover:border-brand-400/50 dark:hover:bg-white/[0.08] dark:hover:text-white"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${pill.dotColor}`} />
                <Plus className="h-3 w-3 opacity-60" />
                <span>{pill.label}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              title="Busca global (Ctrl+K)"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200/90 bg-slate-50/90 px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:border-brand-400/60 hover:text-slate-800 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:border-brand-400/50 dark:hover:text-slate-200"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Buscar...</span>
              <kbd className="hidden rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:border-white/[0.1] dark:bg-slate-900 dark:text-slate-400 md:inline">
                Ctrl K
              </kbd>
            </button>

            <SkinSwitcher />

            <button
              type="button"
              onClick={toggleTheme}
              title={settings?.theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
              aria-label="Alternar tema"
              className="rounded-xl border border-slate-200/90 bg-white p-2 text-slate-600 transition hover:border-brand-400/60 hover:text-brand-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08]"
            >
              {settings?.theme === 'dark' ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
            </button>

            <RemindersMenu />
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 p-5 sm:p-7">{children}</main>
      </div>

      <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Toast notifications */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold shadow-xl animate-scale-in ${
              t.kind === 'error'
                ? 'border border-rose-400/30 bg-rose-600 text-white'
                : t.kind === 'info'
                  ? 'border border-white/10 bg-slate-900 text-white'
                  : 'border border-emerald-400/30 bg-emerald-600 text-white'
            }`}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
