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
  Sparkles,
  Sun,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useApp, type NavSection, type QuickActionType } from '../context/AppContext';
import { getSkinDefinition } from '../services/skins';
import { CURRENT_APP_VERSION } from '../services/updater';
import { ROUTINE_MODE_LABELS } from '../types/domain';
import { AiAssistantDrawer } from './AiAssistantDrawer';
import { CloudSyncQuickButton } from './CloudSyncQuickButton';
import { GlobalSearchModal } from './GlobalSearchModal';
import { RemindersMenu } from './RemindersMenu';
import { SkinSwitcher } from './SkinSwitcher';
import { UpdateBadgeButton } from './UpdateBadgeButton';
import { UpdateBanner } from './UpdateBanner';
import { WindowTitleBar } from './WindowTitleBar';

interface NavItemDef {
  id: NavSection;
  label: string;
  shortLabel: string;
  icon: React.FC<{ className?: string }>;
}

interface NavGroup {
  label: string;
  items: NavItemDef[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Principal',
    items: [
      { id: 'dashboard', label: 'Hoje', shortLabel: 'Hoje', icon: Home },
      { id: 'calendar', label: 'Calendário', shortLabel: 'Agenda', icon: CalendarDays },
    ],
  },
  {
    label: 'Dinheiro & Renda',
    items: [
      { id: 'finance', label: 'Financeiro', shortLabel: 'Finanças', icon: Wallet },
      { id: 'work', label: 'Trabalho', shortLabel: 'Trabalho', icon: Bike },
    ],
  },
  {
    label: 'Vida & Evolução',
    items: [
      { id: 'health', label: 'Saúde', shortLabel: 'Saúde', icon: Heart },
      { id: 'family', label: 'Família', shortLabel: 'Família', icon: Users },
      { id: 'career', label: 'Estudos & TI', shortLabel: 'Estudos', icon: Briefcase },
      { id: 'ideas', label: 'Ideias & Revisão', shortLabel: 'Ideias', icon: Lightbulb },
    ],
  },
  {
    label: 'Sistema',
    items: [{ id: 'settings', label: 'Configurações', shortLabel: 'Config', icon: SettingsIcon }],
  },
];

const FLAT_NAV_ITEMS: NavItemDef[] = NAV_GROUPS.flatMap((g) => g.items);

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
  const [aiOpen, setAiOpen] = useState(false);
  const [mobileQuickOpen, setMobileQuickOpen] = useState(false);

  const activeNavMeta = FLAT_NAV_ITEMS.find((i) => i.id === activeSection) ?? FLAT_NAV_ITEMS[0];

  const activeSkin = getSkinDefinition(settings?.ui_skin);
  const shell = activeSkin.shell;
  const isDualTone = shell === 'dual-tone-sidebar';
  const isDarkRail =
    shell === 'icon-rail' &&
    ['concept_flup_delivery', 'concept_voip_desktop', 'concept_sprinta', 'concept_cyfocus'].includes(
      activeSkin.id,
    );

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
      } else if (key === 'a') {
        e.preventDefault();
        setAiOpen((prev) => !prev);
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

  const renderBrandMark = (compact = false) => (
    <button
      type="button"
      onClick={() => handleSelectNav('dashboard')}
      className={`flex items-center ${compact ? 'justify-center' : 'gap-3'} text-left`}
      title="LifeHub — Central de Vida"
    >
      <div className="lh-brand-badge flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 via-brand-600 to-indigo-700 text-white shadow-glow">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2">
          <circle cx="12" cy="12" r="8" className="opacity-40" />
          <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
        </svg>
      </div>
      {!compact && (
        <div>
          <div className="flex items-center gap-1.5">
            <h1
              className={`text-base font-bold tracking-tight ${
                isDualTone ? 'text-white' : 'text-slate-900 dark:text-white'
              }`}
            >
              LifeHub
            </h1>
            <span className="rounded-md bg-brand-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-500">
              v{CURRENT_APP_VERSION}
            </span>
          </div>
          <p
            className={`text-[11px] font-medium ${
              isDualTone ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            Central de Vida
          </p>
        </div>
      )}
    </button>
  );

  const renderUtilities = () => (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        title="Busca global (Ctrl+K)"
        className="lh-control-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium opacity-85 hover:opacity-100"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden xl:inline">Buscar</span>
        <kbd
          className="hidden rounded border px-1 py-0.5 font-mono text-[10px] opacity-75 2xl:inline"
          style={{ borderColor: 'var(--lh-card-border)' }}
        >
          Ctrl K
        </kbd>
      </button>

      <UpdateBadgeButton />

      <button
        type="button"
        onClick={() => setAiOpen(true)}
        title="Assistente IA Gemini (Alt+A)"
        aria-label="Abrir Assistente IA"
        className="lh-control-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold shadow-sm"
      >
        <Sparkles className="h-3.5 w-3.5 text-brand-500" />
        <span className="hidden sm:inline">IA</span>
      </button>

      <CloudSyncQuickButton />

      <SkinSwitcher />

      <button
        type="button"
        onClick={toggleTheme}
        title={settings?.theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
        aria-label="Alternar tema"
        className="lh-control-btn p-1.5 opacity-85 hover:opacity-100"
      >
        {settings?.theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      </button>

      <RemindersMenu />
    </div>
  );

  const renderQuickPills = (compact = false) => (
    <div className="flex flex-nowrap items-center gap-1 overflow-x-auto">
      {QUICK_PILLS.map((pill) => (
        <button
          key={pill.action}
          type="button"
          onClick={() => openQuickAction(pill.action)}
          title={`Novo: ${pill.label} (${pill.shortcut})`}
          className={`lh-control-btn inline-flex shrink-0 items-center gap-1 ${
            compact ? 'px-2 py-1 text-[11px]' : 'px-2 py-1 text-[11.5px]'
          } font-medium shadow-sm hover:-translate-y-[0.5px]`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${pill.dotColor}`} />
          <Plus className="h-3 w-3 opacity-60" />
          <span>{pill.label}</span>
        </button>
      ))}
    </div>
  );

  const renderMobileHeader = () => (
    <header
      className="lh-topbar lh-safe-top sticky top-0 z-30 flex items-center justify-between gap-2 border-b px-3.5 py-2.5 backdrop-blur-xl lg:hidden"
      style={{ borderColor: 'var(--lh-card-border)' }}
    >
      <button
        type="button"
        onClick={() => handleSelectNav('dashboard')}
        className="flex min-w-0 items-center gap-2.5 text-left"
      >
        <div className="lh-brand-badge flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 via-brand-600 to-indigo-700 text-white shadow-sm">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="12" cy="12" r="8" className="opacity-40" />
            <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold uppercase tracking-wider text-brand-500">
            LifeHub v{CURRENT_APP_VERSION}
          </p>
          <h1 className="truncate text-base font-bold leading-tight text-slate-900 dark:text-white">
            {activeNavMeta.label}
          </h1>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setMobileQuickOpen(true)}
          aria-label="Lançamento rápido"
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm active:scale-95"
        >
          <Plus className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={() => setAiOpen(true)}
          aria-label="Abrir Assistente IA"
          className="lh-control-btn inline-flex h-10 items-center justify-center gap-1 px-2.5 text-xs font-bold active:scale-95"
        >
          <Sparkles className="h-4 w-4 text-brand-500" />
          <span>IA</span>
        </button>

        <CloudSyncQuickButton />

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label="Buscar"
          className="lh-control-btn inline-flex h-10 w-10 items-center justify-center active:scale-95"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>
    </header>
  );

  const renderMobileQuickSheet = () =>
    mobileQuickOpen ? (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 backdrop-blur-sm lg:hidden"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setMobileQuickOpen(false);
        }}
      >
        <div
          className="lh-safe-bottom w-full max-w-lg rounded-t-3xl border-t p-4 shadow-2xl animate-scale-in"
          style={{
            backgroundColor: 'var(--lh-card)',
            borderColor: 'var(--lh-card-border)',
          }}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold">Novo Lançamento Rápido</h2>
            <button
              type="button"
              onClick={() => setMobileQuickOpen(false)}
              aria-label="Fechar"
              className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {QUICK_PILLS.map((pill) => (
              <button
                key={pill.action}
                type="button"
                onClick={() => {
                  setMobileQuickOpen(false);
                  openQuickAction(pill.action);
                }}
                className="lh-control-btn flex min-h-[48px] items-center gap-2.5 rounded-2xl px-3.5 py-3 text-left text-sm font-semibold active:scale-95"
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${pill.dotColor}`} />
                <span>+ {pill.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    ) : null;

  const renderMobileBottomBar = () => {
    const mobileTabs: Array<{
      id: NavSection;
      label: string;
      icon: React.FC<{ className?: string }>;
    }> = [
      { id: 'dashboard', label: 'Hoje', icon: Home },
      { id: 'finance', label: 'Finanças', icon: Wallet },
      { id: 'work', label: 'Uber/99', icon: Bike },
      { id: 'calendar', label: 'Agenda', icon: CalendarDays },
    ];

    return (
      <nav
        aria-label="Navegação mobile"
        className="lh-safe-bottom lh-sidebar fixed inset-x-0 bottom-0 z-30 border-t px-2 pt-2 backdrop-blur-2xl lg:hidden"
        style={{ borderColor: 'var(--lh-card-border)' }}
      >
        <div className="mx-auto grid max-w-lg grid-cols-5 gap-1">
          {mobileTabs.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectNav(item.id)}
                className={`flex min-h-[50px] flex-col items-center justify-center gap-1 rounded-xl py-1.5 text-[11px] font-semibold transition active:scale-95 ${
                  active
                    ? 'bg-brand-600/15 text-brand-500'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className={`flex min-h-[50px] flex-col items-center justify-center gap-1 rounded-xl py-1.5 text-[11px] font-semibold transition active:scale-95 ${
              !mobileTabs.some((t) => t.id === activeSection)
                ? 'bg-brand-600/15 text-brand-500'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Menu className="h-5 w-5" />
            <span>Menu</span>
          </button>
        </div>
      </nav>
    );
  };

  const renderMobileDrawerForAltShells = () =>
    sidebarOpen ? (
      <div className="fixed inset-0 z-50 flex lg:hidden">
        <div
          className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
        <aside
          className="lh-sidebar lh-safe-top relative z-10 flex w-64 max-w-[82vw] flex-col border-r shadow-2xl"
          style={{ borderColor: 'var(--lh-card-border)' }}
        >
          <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5">
            {renderBrandMark()}
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
              aria-label="Fechar menu"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav className="flex-1 space-y-2.5 overflow-y-auto px-3 py-2" aria-label="Menu completo">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-1 px-2 text-[9.5px] font-semibold uppercase tracking-wider text-slate-400">
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
                        className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-xs font-medium transition ${
                          active
                            ? 'bg-brand-600 text-white shadow-sm'
                            : 'text-slate-600 hover:bg-black/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.06]'
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>
      </div>
    ) : null;

  const renderOverlays = () => (
    <>
      {renderMobileBottomBar()}
      {renderMobileQuickSheet()}
      <UpdateBanner />
      <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <AiAssistantDrawer open={aiOpen} onClose={() => setAiOpen(false)} />
      <div className="fixed bottom-24 right-4 z-[60] flex flex-col gap-2 lg:bottom-5 lg:right-5">
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
    </>
  );

  // =========================================================================
  // SHELL 1: TOP-NAV (sem sidebar lateral — barra horizontal superior completa)
  // =========================================================================
  if (shell === 'top-nav') {
    return (
      <div className="lh-app-shell flex h-screen flex-col overflow-hidden text-slate-900 dark:text-slate-100">
        <WindowTitleBar />

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {renderMobileHeader()}
          <header className="lh-topbar sticky top-0 z-30 hidden border-b backdrop-blur-xl lg:block">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
              {renderBrandMark()}

              <nav
                aria-label="Navegação principal"
                className="hidden items-center gap-1 overflow-x-auto rounded-2xl border p-1 lg:flex"
                style={{
                  borderColor: 'var(--lh-card-border)',
                  backgroundColor: 'var(--lh-canvas)',
                }}
              >
                {FLAT_NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectNav(item.id)}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                        active
                          ? 'lh-nav-active bg-brand-600 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-black/[0.05] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{item.shortLabel}</span>
                    </button>
                  );
                })}
              </nav>

              {renderUtilities()}
            </div>

            <div className="border-t" style={{ borderColor: 'var(--lh-card-border)' }}>
              <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
                {renderQuickPills(true)}
                {settings && (
                  <div className="hidden items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400 md:flex">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span>
                      {ROUTINE_MODE_LABELS[settings.routine_mode]} · {settings.work_days_per_week}d/sem
                    </span>
                    <span className="opacity-40">|</span>
                    <span>{db?.driverName === 'tauri-sqlite' ? 'SQLite nativo' : 'SQLite local'}</span>
                  </div>
                )}
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1380px] flex-1 p-3.5 pb-24 sm:p-5 lg:pb-5">{children}</main>
        </div>

        {renderMobileDrawerForAltShells()}
        {renderOverlays()}
      </div>
    );
  }

  // =========================================================================
  // SHELL 2: BOTTOM-DOCK (estilo Windows 11 / QleanDesk / IQON Dock Inferior)
  // =========================================================================
  if (shell === 'bottom-dock') {
    return (
      <div className="lh-app-shell flex h-screen flex-col overflow-hidden text-slate-900 dark:text-slate-100">
        <WindowTitleBar />

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {renderMobileHeader()}
          <header className="lh-topbar sticky top-3 z-20 mx-auto mt-3 hidden w-[calc(100%-2rem)] max-w-7xl flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 shadow-lg backdrop-blur-xl lg:flex">
            <div className="flex items-center gap-3">
              {renderBrandMark()}
              {settings && (
                <span className="hidden rounded-full border border-brand-500/30 bg-brand-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-brand-500 md:inline-flex">
                  {ROUTINE_MODE_LABELS[settings.routine_mode]} · {settings.work_days_per_week}d/sem
                </span>
              )}
            </div>

            <div className="hidden xl:block">{renderQuickPills(true)}</div>
            {renderUtilities()}
          </header>

          <div className="mx-auto mt-3 hidden w-[calc(100%-2rem)] max-w-7xl justify-center lg:flex xl:hidden">
            {renderQuickPills(true)}
          </div>

          <main className="mx-auto w-full max-w-[1380px] flex-1 px-4 pt-3.5 pb-24 sm:px-5 lg:pb-20">{children}</main>
        </div>

        {/* Floating Windows/macOS style bottom dock (desktop only; mobile uses bottom bar) */}
        <nav
          aria-label="Dock principal"
          className="lh-dock lh-sidebar fixed bottom-4 left-1/2 z-30 hidden max-w-[95vw] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-2xl border px-2.5 py-2 shadow-2xl backdrop-blur-2xl lg:flex"
        >
          {FLAT_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectNav(item.id)}
                title={item.label}
                className={`group relative flex shrink-0 flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 transition-all duration-150 hover:-translate-y-1 ${
                  active
                    ? 'lh-nav-active bg-brand-600 text-white shadow-md'
                    : 'text-slate-600 hover:bg-black/[0.06] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.09] dark:hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="text-[10px] font-semibold leading-none">{item.shortLabel}</span>
                {active && (
                  <span className="absolute -bottom-1 h-1 w-4 rounded-full bg-brand-400" />
                )}
              </button>
            );
          })}
        </nav>

        {renderMobileDrawerForAltShells()}
        {renderOverlays()}
      </div>
    );
  }

  // =========================================================================
  // SHELL 3: ICON-RAIL (rail vertical fino 78px estilo app nativo desktop)
  // =========================================================================
  if (shell === 'icon-rail') {
    return (
      <div className="lh-app-shell flex h-screen flex-col overflow-hidden text-slate-900 dark:text-slate-100">
        <WindowTitleBar />

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-sm lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          <aside
            className={`lh-sidebar ${
              isDarkRail ? 'lh-rail-dark-tone' : ''
            } fixed inset-y-0 left-0 z-40 flex w-[78px] shrink-0 flex-col items-center border-r py-4 backdrop-blur-xl transition-transform duration-200 lg:static lg:translate-x-0 ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            {renderBrandMark(true)}

            <nav
              className="mt-5 flex flex-1 flex-col items-center gap-1.5 overflow-y-auto px-2"
              aria-label="Navegação principal"
            >
              {FLAT_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectNav(item.id)}
                    title={item.label}
                    className={`group relative flex h-12 w-14 flex-col items-center justify-center gap-0.5 rounded-xl text-[9px] font-semibold transition ${
                      active
                        ? 'lh-nav-active bg-brand-600 text-white shadow-md'
                        : isDarkRail
                          ? 'text-slate-400 hover:bg-white/[0.08] hover:text-white'
                          : 'text-slate-500 hover:bg-black/[0.05] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.07] dark:hover:text-white'
                    }`}
                  >
                    {active && (
                      <span className="absolute -left-2 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-brand-400" />
                    )}
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.shortLabel}</span>
                  </button>
                );
              })}
            </nav>

            <div
              className="mt-3 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400"
              title={
                db?.driverName === 'tauri-sqlite'
                  ? '100% Local-First · SQLite nativo'
                  : '100% Local-First · SQLite local'
              }
            >
              <ShieldCheck className="h-4 w-4" />
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            {renderMobileHeader()}
            <header className="lh-topbar sticky top-0 z-20 hidden flex-nowrap items-center justify-between gap-2 border-b px-3.5 py-2 backdrop-blur-xl sm:px-5 lg:flex">
              <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="lh-control-btn shrink-0 p-1.5 lg:hidden"
                  aria-label="Abrir menu"
                >
                  <Menu className="h-4 w-4" />
                </button>
                {renderQuickPills()}
              </div>
              {renderUtilities()}
            </header>

            <main className="mx-auto w-full max-w-[1440px] flex-1 p-3.5 pb-24 sm:p-5 lg:pb-5">{children}</main>
          </div>
        </div>

        {renderOverlays()}
      </div>
    );
  }

  // =========================================================================
  // SHELL 4, 5 & 6: FLOATING-ISLAND | DUAL-TONE-SIDEBAR | SIDEBAR-CLASSIC
  // =========================================================================
  const isFloating = shell === 'floating-island';

  return (
    <div className="lh-app-shell flex h-screen flex-col overflow-hidden text-slate-900 dark:text-slate-100">
      <WindowTitleBar />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-950/75 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside
          className={`lh-sidebar lh-safe-top ${
            isDualTone ? 'lh-sidebar-dark-tone' : ''
          } fixed inset-y-0 left-0 z-50 flex w-64 max-w-[82vw] shrink-0 flex-col backdrop-blur-xl transition-transform duration-200 lg:static lg:z-auto lg:w-56 lg:translate-x-0 ${
            isFloating
              ? 'border lg:m-3 lg:mr-0 lg:rounded-2xl lg:shadow-xl'
              : 'border-r'
          } ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          {/* Brand header */}
          <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5">
            {renderBrandMark()}
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/[0.06] lg:hidden"
              aria-label="Fechar menu"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Mode & Demo pills */}
          {settings && (
            <div
              className={`mx-3 mb-2 rounded-xl border px-2.5 py-2 ${
                isDualTone
                  ? 'border-white/10 bg-white/[0.05]'
                  : 'bg-black/[0.025] dark:bg-white/[0.03]'
              }`}
              style={!isDualTone ? { borderColor: 'var(--lh-card-border)' } : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-400">
                  Modo ativo
                </span>
                {settings.demo_data_loaded === 1 && (
                  <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-500 dark:text-amber-300">
                    Demo
                  </span>
                )}
              </div>
              <p
                className={`mt-0.5 truncate text-[11.5px] font-semibold ${
                  isDualTone ? 'text-brand-300' : 'text-brand-600 dark:text-brand-300'
                }`}
              >
                {ROUTINE_MODE_LABELS[settings.routine_mode]} · {settings.work_days_per_week}d/sem
              </p>
            </div>
          )}

          {/* Grouped Navigation */}
          <nav className="flex-1 space-y-2.5 overflow-y-auto px-2.5 py-1.5" aria-label="Navegação principal">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p
                  className={`mb-1 px-2.5 text-[9.5px] font-semibold uppercase tracking-wider ${
                    isDualTone ? 'text-slate-400/80' : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
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
                        className={`group relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-[12.5px] font-medium transition-all ${
                          active
                            ? isDualTone
                              ? 'lh-nav-active bg-brand-500 text-white shadow-sm'
                              : 'lh-nav-active bg-brand-600/12 text-brand-700 dark:bg-brand-500/15 dark:text-white'
                            : isDualTone
                              ? 'text-slate-300 hover:bg-white/[0.07] hover:text-white'
                              : 'text-slate-600 hover:bg-black/[0.04] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.04] dark:hover:text-slate-100'
                        }`}
                      >
                        {active && !isDualTone && (
                          <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-500" />
                        )}
                        <Icon
                          className={`h-4 w-4 shrink-0 transition-colors ${
                            active
                              ? isDualTone
                                ? 'text-white'
                                : 'text-brand-600 dark:text-brand-400'
                              : isDualTone
                                ? 'text-slate-400 group-hover:text-white'
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

          {/* Mobile quick theme & settings strip inside drawer */}
          <div className="flex items-center gap-2 px-3 pb-2 lg:hidden">
            <button
              type="button"
              onClick={toggleTheme}
              className="lh-control-btn flex h-10 flex-1 items-center justify-center gap-1.5 px-3 text-xs font-semibold"
            >
              {settings?.theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span>{settings?.theme === 'dark' ? 'Tema Claro' : 'Tema Escuro'}</span>
            </button>
          </div>

          {/* Local-first status badge */}
          <div
            className="border-t p-3"
            style={{ borderColor: isDualTone ? 'rgba(255,255,255,0.1)' : 'var(--lh-card-border)' }}
          >
            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-500/[0.1] px-3 py-2.5 text-[11px] ring-1 ring-emerald-500/25">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
              <div className="min-w-0">
                <p
                  className={`font-semibold ${
                    isDualTone ? 'text-emerald-300' : 'text-emerald-700 dark:text-emerald-300'
                  }`}
                >
                  100% Local-First
                </p>
                <p
                  className={`truncate text-[10px] ${
                    isDualTone ? 'text-slate-400' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {db?.driverName === 'tauri-sqlite'
                    ? 'SQLite nativo no dispositivo'
                    : 'SQLite local (Offline)'}
                </p>
              </div>
            </div>
          </div>
        </aside>

        {/* Main area */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {renderMobileHeader()}
          <header
            className={`lh-topbar sticky z-20 hidden flex-nowrap items-center justify-between gap-2 backdrop-blur-xl lg:flex ${
              isFloating
                ? 'top-3 mx-5 mt-3 rounded-2xl border px-3.5 py-2 shadow-sm'
                : 'top-0 border-b px-5 py-2'
            }`}
          >
            <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="lh-control-btn mr-1 shrink-0 p-1.5 lg:hidden"
                aria-label="Abrir menu"
              >
                <Menu className="h-4 w-4" />
              </button>
              {renderQuickPills()}
            </div>
            {renderUtilities()}
          </header>

          <main className="mx-auto w-full max-w-[1380px] flex-1 p-3.5 pb-24 sm:p-5 lg:pb-5">{children}</main>
        </div>
      </div>

      {renderOverlays()}
    </div>
  );
};
