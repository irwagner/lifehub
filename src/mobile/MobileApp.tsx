import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bike,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  Cloud,
  CloudOff,
  Copy,
  Eye,
  EyeOff,
  Heart,
  Home,
  Lightbulb,
  Moon,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  Wallet,
  X,
} from 'lucide-react';
import { getDatabase } from '../db/client';
import type { SqlExecutor } from '../db/types';
import {
  createCalendarEvent,
  createTask,
  listCalendarEvents,
  listTasks,
  toggleTaskStatus,
} from '../repositories/calendarRepo';
import { loadDashboardSnapshot, type DashboardSnapshot } from '../repositories/dashboardRepo';
import {
  createTransaction,
  listAccounts,
  listCategories,
  listTransactions,
} from '../repositories/financeRepo';
import { logHabitSession } from '../repositories/habitsRepo';
import { createIdea, listIdeas } from '../repositories/ideasRepo';
import { createWorkSession, listWorkSessions } from '../repositories/workRepo';
import { calculateWorkSessionMetrics } from '../services/calculations';
import {
  AutoSyncController,
  isCloudSyncReady,
  loadCloudSyncConfig,
  parseMobilePairingHash,
  saveCloudSyncConfig,
  syncDatabaseWithCloud,
  testCloudSyncConnection,
  type AutoSyncStatus,
  type CloudSyncConfig,
} from '../services/cloudSync';
import {
  askLifeHubAssistant,
  executeProposedAiAction,
  loadAiChatHistory,
  loadGeminiAiConfig,
  saveAiChatHistory,
  saveGeminiAiConfig,
  type AiChatMessage,
  type GeminiAiConfig,
  type ProposedAiAction,
} from '../services/geminiAi';
import { CURRENT_APP_VERSION } from '../services/updater';
import {
  EVENT_CATEGORY_META,
  PLATFORM_LABELS,
  type Account,
  type CalendarEvent,
  type Category,
  type EventCategory,
  type IdeaItem,
  type TaskItem,
  type TaskPriority,
  type Transaction,
  type TransactionType,
  type WorkPlatform,
  type WorkSession,
} from '../types/domain';
import {
  addDaysISO,
  formatBRL,
  formatDateBR,
  formatNumber,
  formatTimeBR,
  greetingForHour,
  todayISO,
} from '../utils/format';

type MobileTab = 'today' | 'agenda' | 'finance' | 'work' | 'sync';
type QuickSheetKind = null | 'transaction' | 'work' | 'task' | 'event' | 'idea';

function detectMobileDeviceName(): string {
  const ua = navigator.userAgent || '';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  return 'Celular';
}

export const MobileApp: React.FC = () => {
  const [db, setDb] = useState<SqlExecutor | null>(null);
  const [loading, setLoading] = useState(true);
  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem('lifehub_mobile_theme');
    return saved ? saved === 'dark' : true;
  });
  const [tab, setTab] = useState<MobileTab>('today');
  const [sheet, setSheet] = useState<QuickSheetKind>(null);
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);

  // Live SQLite snapshots
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEvent[]>([]);
  const [allTasks, setAllTasks] = useState<TaskItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [ideas, setIdeas] = useState<IdeaItem[]>([]);

  // Cloud Sync state
  const [syncConfig, setSyncConfig] = useState<CloudSyncConfig>(() =>
    loadCloudSyncConfig(detectMobileDeviceName()),
  );
  const [syncing, setSyncing] = useState(false);
  const [autoSyncStatus, setAutoSyncStatus] = useState<AutoSyncStatus>('idle');
  const [showKey, setShowKey] = useState(false);
  const [justPairedBanner, setJustPairedBanner] = useState(false);
  const autoSyncRef = useRef<AutoSyncController | null>(null);
  const lastFocusSyncRef = useRef(0);
  const [syncUrlInput, setSyncUrlInput] = useState(() =>
    loadCloudSyncConfig(detectMobileDeviceName()).endpointUrl ||
    (window.location.origin.startsWith('http') && !window.location.hostname.includes('localhost')
      ? window.location.origin
      : ''),
  );
  const [syncKeyInput, setSyncKeyInput] = useState(
    () => loadCloudSyncConfig(detectMobileDeviceName()).passphrase,
  );

  // Mobile Gemini AI state
  const [aiOpen, setAiOpen] = useState(false);
  const [aiConfig, setAiConfig] = useState<GeminiAiConfig>(() => loadGeminiAiConfig());
  const [aiKeyInput, setAiKeyInput] = useState(() => loadGeminiAiConfig().apiKey);
  const [aiMessages, setAiMessages] = useState<AiChatMessage[]>(() => loadAiChatHistory());
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Quick-add form states
  const [txType, setTxType] = useState<TransactionType>('expense');
  const [txDesc, setTxDesc] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txAccount, setTxAccount] = useState('acc_principal');
  const [txCategory, setTxCategory] = useState('cat_alimentacao');

  const [wsPlatform, setWsPlatform] = useState<WorkPlatform>('ambos');
  const [wsGross, setWsGross] = useState('');
  const [wsKm, setWsKm] = useState('');
  const [wsFuel, setWsFuel] = useState('');
  const [wsStart, setWsStart] = useState('07:00');
  const [wsEnd, setWsEnd] = useState('12:30');
  const [wsSyncFin, setWsSyncFin] = useState(true);

  const [tkTitle, setTkTitle] = useState('');
  const [tkPriority, setTkPriority] = useState<TaskPriority>('medium');

  const [evTitle, setEvTitle] = useState('');
  const [evDate, setEvDate] = useState(todayISO());
  const [evStart, setEvStart] = useState('09:00');
  const [evEnd, setEvEnd] = useState('10:00');
  const [evCat, setEvCat] = useState<EventCategory>('geral');

  const [ideaTitle, setIdeaTitle] = useState('');

  const showToast = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ text, kind });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('lifehub_mobile_theme', dark ? 'dark' : 'light');
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', dark ? '#0b1120' : '#f8fafc');
  }, [dark]);

  const refreshData = useCallback(async (database: SqlExecutor) => {
    const today = todayISO();
    const [dash, events, tasks, txs, accs, cats, workList, ideaList] = await Promise.all([
      loadDashboardSnapshot(database, today),
      listCalendarEvents(database, {
        startISO: `${today}T00:00:00`,
        endISO: `${addDaysISO(today, 14)}T23:59:59`,
      }),
      listTasks(database),
      listTransactions(database),
      listAccounts(database),
      listCategories(database),
      listWorkSessions(database),
      listIdeas(database),
    ]);

    setSnapshot(dash);
    setUpcomingEvents(events);
    setAllTasks(tasks);
    setTransactions(txs);
    setAccounts(accs);
    setCategories(cats);
    setSessions(workList);
    setIdeas(ideaList);
    if (accs[0]) setTxAccount(accs[0].id);
  }, []);

  const runSync = useCallback(
    async (database: SqlExecutor, cfg: CloudSyncConfig) => {
      if (!cfg.endpointUrl.trim() || !cfg.passphrase.trim()) {
        showToast('Configure a URL do Cloudflare e a Chave Secreta na aba Sync.', 'err');
        setTab('sync');
        return;
      }
      setSyncing(true);
      try {
        const res = await syncDatabaseWithCloud(database, {
          endpointUrl: cfg.endpointUrl,
          passphrase: cfg.passphrase,
          deviceName: cfg.deviceName,
        });
        const updatedCfg: CloudSyncConfig = {
          ...cfg,
          enabled: true,
          lastSyncedAt: res.syncedAt,
          lastRevision: res.revision,
        };
        saveCloudSyncConfig(updatedCfg);
        setSyncConfig(updatedCfg);
        await refreshData(database);
        showToast(
          res.remoteHadData
            ? `Sincronizado (rev. ${res.revision}) · dados mesclados.`
            : `Cofre inicializado na nuvem (rev. ${res.revision}).`,
        );
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Erro ao sincronizar.', 'err');
      } finally {
        setSyncing(false);
      }
    },
    [refreshData, showToast],
  );

  // Initialize local SQLite + handle magic pairing link (#pair=...)
  useEffect(() => {
    let active = true;
    (async () => {
      const database = await getDatabase();
      if (!active) return;
      setDb(database);
      await refreshData(database);
      setLoading(false);

      const paired = parseMobilePairingHash(window.location.hash);
      if (paired) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        const nextCfg: CloudSyncConfig = {
          enabled: true,
          endpointUrl: paired.endpointUrl,
          passphrase: paired.passphrase,
          deviceName: detectMobileDeviceName(),
          lastSyncedAt: null,
          lastRevision: 0,
        };
        saveCloudSyncConfig(nextCfg);
        setSyncConfig(nextCfg);
        setSyncUrlInput(paired.endpointUrl);
        setSyncKeyInput(paired.passphrase);
        const isStandalonePwa =
          window.matchMedia?.('(display-mode: standalone)').matches ||
          Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
        if (!isStandalonePwa) {
          setJustPairedBanner(true);
        }
        showToast('QR Code / link detectado! Sincronizando...');
        await runSync(database, nextCfg);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshData, runSync, showToast]);

  // Auto-Sync controller on Mobile PWA (syncs every action + startup + returning to app)
  useEffect(() => {
    if (!db) return;
    const controller = new AutoSyncController({
      debounceMs: 1200,
      getConfig: () => loadCloudSyncConfig(detectMobileDeviceName()),
      runSyncFn: (cfg) => syncDatabaseWithCloud(db, cfg),
      onStateChange: (st) => {
        setAutoSyncStatus(st);
        setSyncing(st === 'syncing');
      },
      onSynced: async (res, updatedCfg) => {
        setSyncConfig(updatedCfg);
        if (res.remoteHadData) {
          await refreshData(db);
        }
      },
    });
    autoSyncRef.current = controller;

    // Initial background sync if already paired (and not handling #pair= hash)
    const initTimer = window.setTimeout(() => {
      const cfg = loadCloudSyncConfig(detectMobileDeviceName());
      if (isCloudSyncReady(cfg) && cfg.autoSync !== false) {
        lastFocusSyncRef.current = Date.now();
        void controller.flushNow();
      }
    }, 1500);

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastFocusSyncRef.current < 15_000) return;
      const cfg = loadCloudSyncConfig(detectMobileDeviceName());
      if (isCloudSyncReady(cfg) && cfg.autoSync !== false) {
        lastFocusSyncRef.current = now;
        void controller.flushNow();
      }
    };

    const handleOnline = () => {
      const cfg = loadCloudSyncConfig(detectMobileDeviceName());
      if (isCloudSyncReady(cfg) && cfg.autoSync !== false) {
        void controller.flushNow();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);

    return () => {
      window.clearTimeout(initTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      controller.dispose();
      autoSyncRef.current = null;
    };
  }, [db, refreshData]);

  const scheduleAutoSync = useCallback(() => {
    autoSyncRef.current?.schedule();
  }, []);

  const handleToggleTask = async (id: string) => {
    if (!db) return;
    await toggleTaskStatus(db, id);
    await refreshData(db);
    scheduleAutoSync();
    showToast('Tarefa atualizada.');
  };

  const handleQuickHabit = async (habitId: string, name: string) => {
    if (!db) return;
    await logHabitSession(db, { habit_id: habitId, date: todayISO(), duration_minutes: 30 });
    await refreshData(db);
    scheduleAutoSync();
    showToast(`${name} registrado!`);
  };

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await createTransaction(db, {
        account_id: txAccount,
        category_id: txCategory,
        type: txType,
        source_type: 'outros',
        description: txDesc,
        amount: Number(txAmount),
        date: todayISO(),
        status: 'realized',
      });
      setTxDesc('');
      setTxAmount('');
      setSheet(null);
      await refreshData(db);
      scheduleAutoSync();
      showToast('Lançamento salvo e sincronizando...');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao salvar.', 'err');
    }
  };

  const handleCreateWork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !snapshot) return;
    try {
      const grossNum = Number(wsGross);
      const fuelNum = Number(wsFuel) || 0;
      const created = await createWorkSession(
        db,
        {
          date: todayISO(),
          platform: wsPlatform,
          start_time: wsStart,
          end_time: wsEnd,
          gross_amount: grossNum,
          km_total: Number(wsKm) || 0,
          fuel_cost: fuelNum,
        },
        snapshot.settings,
      );
      if (wsSyncFin && accounts[0]) {
        if (grossNum > 0) {
          await createTransaction(db, {
            account_id: accounts[0].id,
            category_id: 'cat_apps',
            type: 'income',
            source_type: 'aplicativos',
            description: `Jornada ${PLATFORM_LABELS[wsPlatform]} (${created.km_total} km)`,
            amount: grossNum,
            date: todayISO(),
            status: 'realized',
          });
        }
        if (fuelNum > 0) {
          await createTransaction(db, {
            account_id: accounts[0].id,
            category_id: 'cat_combustivel',
            type: 'expense',
            source_type: 'aplicativos',
            description: `Combustível (${created.km_total} km)`,
            amount: fuelNum,
            date: todayISO(),
            status: 'realized',
          });
        }
      }
      setWsGross('');
      setWsKm('');
      setWsFuel('');
      setSheet(null);
      await refreshData(db);
      scheduleAutoSync();
      showToast('Jornada Uber/99 registrada!');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao registrar jornada.', 'err');
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await createTask(db, {
        title: tkTitle,
        priority: tkPriority,
        due_date: todayISO(),
      });
      setTkTitle('');
      setSheet(null);
      await refreshData(db);
      scheduleAutoSync();
      showToast('Tarefa adicionada.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao criar tarefa.', 'err');
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await createCalendarEvent(db, {
        title: evTitle,
        category: evCat,
        start_at: `${evDate}T${evStart}:00`,
        end_at: `${evDate}T${evEnd}:00`,
      });
      setEvTitle('');
      setSheet(null);
      await refreshData(db);
      scheduleAutoSync();
      showToast('Compromisso salvo na agenda.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao salvar compromisso.', 'err');
    }
  };

  const handleCreateIdea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    try {
      await createIdea(db, { title: ideaTitle, impact: 4, effort: 2 });
      setIdeaTitle('');
      setSheet(null);
      await refreshData(db);
      scheduleAutoSync();
      showToast('Ideia capturada.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao salvar ideia.', 'err');
    }
  };

  const handleSaveAndSync = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;
    const nextCfg: CloudSyncConfig = {
      ...syncConfig,
      enabled: true,
      endpointUrl: syncUrlInput.trim(),
      passphrase: syncKeyInput.trim(),
      deviceName: syncConfig.deviceName || detectMobileDeviceName(),
    };
    saveCloudSyncConfig(nextCfg);
    setSyncConfig(nextCfg);
    await runSync(db, nextCfg);
  };

  const handleTestServer = async () => {
    try {
      const res = await testCloudSyncConnection(syncUrlInput);
      showToast(res.message);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Falha na conexão.', 'err');
    }
  };

  const handleSaveMobileAiKey = (e: React.FormEvent) => {
    e.preventDefault();
    const next: GeminiAiConfig = { ...aiConfig, apiKey: aiKeyInput.trim() };
    saveGeminiAiConfig(next);
    setAiConfig(next);
    showToast('Chave Gemini salva neste celular!');
  };

  const handleSendMobileAi = async (textToSend: string) => {
    if (!db || !textToSend.trim() || aiLoading) return;
    const userMsg: AiChatMessage = {
      id: `mu_${Date.now()}`,
      role: 'user',
      text: textToSend.trim(),
      createdAt: new Date().toISOString(),
    };
    const nextHist = [...aiMessages, userMsg];
    setAiMessages(nextHist);
    setAiPrompt('');
    setAiLoading(true);
    try {
      const reply = await askLifeHubAssistant(db, aiConfig, aiMessages, userMsg.text);
      const executedIds: string[] = [];
      const savedNotes: string[] = [];
      let savedNotice = '';
      if (aiConfig.autoExecuteActions && snapshot && reply.actions.length > 0) {
        for (const act of reply.actions) {
          try {
            savedNotice = await executeProposedAiAction(db, snapshot.settings, act);
            executedIds.push(act.id);
            savedNotes.push(savedNotice);
          } catch (actErr) {
            showToast(actErr instanceof Error ? actErr.message : 'Erro ao salvar ação.', 'err');
          }
        }
        if (executedIds.length > 0) {
          await refreshData(db);
          scheduleAutoSync();
          showToast(savedNotice || 'Lançamento salvo automaticamente!');
        }
      }
      const nextMsgs: AiChatMessage[] = [
        ...nextHist,
        {
          id: `ma_${Date.now()}`,
          role: 'assistant',
          text: reply.text,
          modelUsed: reply.modelUsed,
          actions: reply.actions,
          executedActionIds: executedIds,
          actionResultNotes: savedNotes,
          autoExecuted: executedIds.length > 0,
          createdAt: new Date().toISOString(),
        },
      ];
      setAiMessages(nextMsgs);
      saveAiChatHistory(nextMsgs);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao consultar Gemini.', 'err');
    } finally {
      setAiLoading(false);
    }
  };

  const handleExecuteMobileAiAction = async (msgId: string, action: ProposedAiAction) => {
    if (!db || !snapshot) return;
    try {
      const msg = await executeProposedAiAction(db, snapshot.settings, action);
      setAiMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, executedActionIds: [...(m.executedActionIds ?? []), action.id] }
            : m,
        ),
      );
      await refreshData(db);
      scheduleAutoSync();
      showToast(msg);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao salvar ação.', 'err');
    }
  };

  if (loading || !snapshot) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-lg font-bold text-white shadow-lg">
            LH
          </div>
          <p className="text-sm font-medium">Carregando LifeHub Mobile...</p>
        </div>
      </div>
    );
  }

  const isSyncedConfigured = Boolean(syncConfig.endpointUrl && syncConfig.passphrase);
  const card =
    'rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-slate-900/90';
  const input =
    'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-slate-950 dark:text-slate-100';

  const tabTitles: Record<MobileTab, string> = {
    today: `${greetingForHour()}${snapshot.settings.user_name ? `, ${snapshot.settings.user_name}` : ''}`,
    agenda: 'Agenda & Tarefas',
    finance: 'Financeiro',
    work: 'Uber / 99 Moto',
    sync: 'Sync & Mais',
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#0b1120] dark:text-slate-100">
      {/* Sticky Clean Mobile Header */}
      <header className="safe-top sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 px-4 pb-3 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#0b1120]/90">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              LifeHub v{CURRENT_APP_VERSION} · {formatDateBR(snapshot.today)}
            </p>
            <h1 className="truncate text-lg font-bold tracking-tight">{tabTitles[tab]}</h1>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAiOpen(true)}
              aria-label="Abrir Assistente IA Gemini"
              className="inline-flex items-center gap-1 rounded-full border border-indigo-500/35 bg-indigo-500/10 px-2.5 py-1.5 text-xs font-bold text-indigo-600 active:scale-95 dark:text-indigo-300"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>IA</span>
            </button>

            <button
              type="button"
              disabled={syncing}
              onClick={() => (db ? runSync(db, syncConfig) : undefined)}
              aria-label="Sincronizar com Desktop"
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition active:scale-95 ${
                isSyncedConfigured
                  ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300'
              }`}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${syncing || autoSyncStatus === 'scheduled' ? 'animate-spin' : ''}`}
              />
              <span>
                {syncing
                  ? 'Sync...'
                  : autoSyncStatus === 'scheduled'
                    ? 'Auto...'
                    : 'Sync'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setDark((d) => !d)}
              aria-label="Alternar tema"
              className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-200"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-lg space-y-4 px-4 pt-4 pb-28">
        {justPairedBanner && (
          <section className="rounded-2xl border border-indigo-500/35 bg-indigo-600/10 p-4 text-xs shadow-sm dark:bg-indigo-500/15">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-indigo-700 dark:text-indigo-300">
                <Smartphone className="h-4 w-4 shrink-0" />
                <span>Pareado! Instale na Tela de Início</span>
              </div>
              <button
                type="button"
                onClick={() => setJustPairedBanner(false)}
                aria-label="Fechar aviso"
                className="rounded-lg p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 leading-relaxed text-slate-700 dark:text-slate-200">
              No <strong>iPhone (Safari)</strong>, toque em <strong>Compartilhar ↑</strong> →{' '}
              <strong>Adicionar à Tela de Início</strong>. Se abrir pelo ícone da Tela de Início sem os dados, cole a chave abaixo na aba <strong>Sync</strong>.
            </p>
            {syncKeyInput.trim().length >= 8 && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(syncKeyInput.trim());
                    showToast('Chave Secreta copiada!');
                  } catch {
                    showToast('Copie a chave manualmente na aba Sync.', 'err');
                  }
                }}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm active:scale-95"
              >
                <Copy className="h-3.5 w-3.5" /> Copiar Chave Secreta
              </button>
            )}
          </section>
        )}
        {/* TAB 1: HOJE */}
        {tab === 'today' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setTab('finance')}
                className={`${card} text-left active:scale-[0.99]`}
              >
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Saldo Atual
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">
                  {formatBRL(snapshot.totalBalance)}
                </p>
                <p className="mt-1 text-[11px] tabular-nums text-emerald-500">
                  Mês: {formatBRL(snapshot.monthlyFinance.realizedNet)}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setTab('work')}
                className={`${card} text-left active:scale-[0.99]`}
              >
                <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Uber/99 Semana
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums text-emerald-500">
                  {formatBRL(snapshot.workWeek.totalOperationalNet)}
                </p>
                <p className="mt-1 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                  Bruto {formatBRL(snapshot.workWeek.totalGross)} ·{' '}
                  {formatNumber(snapshot.workWeek.totalKm, 0)} km
                </p>
              </button>
            </div>

            {/* Today's schedule */}
            <section className={card}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold">Agenda de Hoje</h2>
                <button
                  type="button"
                  onClick={() => setSheet('event')}
                  className="text-xs font-semibold text-indigo-500"
                >
                  + Evento
                </button>
              </div>
              {snapshot.todayEvents.length === 0 ? (
                <p className="py-3 text-center text-xs text-slate-500">
                  Nenhum compromisso marcado para hoje.
                </p>
              ) : (
                <ul className="space-y-2">
                  {snapshot.todayEvents.map((ev) => (
                    <li
                      key={ev.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 dark:bg-white/[0.04]"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="h-8 w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: ev.color }}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{ev.title}</p>
                          <p className="text-[11px] text-slate-500">
                            {EVENT_CATEGORY_META[ev.category]?.label ?? ev.category}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-300">
                        {formatTimeBR(ev.start_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Priority Tasks */}
            <section className={card}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold">Tarefas ({snapshot.priorityTasks.length})</h2>
                <button
                  type="button"
                  onClick={() => setSheet('task')}
                  className="text-xs font-semibold text-indigo-500"
                >
                  + Tarefa
                </button>
              </div>
              {snapshot.priorityTasks.length === 0 ? (
                <p className="py-3 text-center text-xs text-slate-500">Tudo concluído por aqui!</p>
              ) : (
                <ul className="space-y-2">
                  {snapshot.priorityTasks.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => handleToggleTask(t.id)}
                        className="flex w-full items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-left active:scale-[0.99] dark:bg-white/[0.04]"
                      >
                        {t.status === 'done' ? (
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                        ) : (
                          <Circle className="h-5 w-5 shrink-0 text-slate-400" />
                        )}
                        <span className="flex-1 text-sm font-medium">{t.title}</span>
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                            t.priority === 'high'
                              ? 'bg-rose-500/15 text-rose-500'
                              : t.priority === 'medium'
                                ? 'bg-amber-500/15 text-amber-500'
                                : 'bg-slate-500/15 text-slate-400'
                          }`}
                        >
                          {t.priority === 'high' ? 'Alta' : t.priority === 'medium' ? 'Média' : 'Baixa'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Quick Habits */}
            <section className={card}>
              <div className="mb-3 flex items-center gap-2">
                <Heart className="h-4 w-4 text-emerald-500" />
                <h2 className="text-sm font-bold">Hábitos de Hoje</h2>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {snapshot.habits.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => handleQuickHabit(h.id, h.name)}
                    className={`flex items-center justify-between rounded-xl border p-3 text-left transition active:scale-95 ${
                      h.doneToday
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                        : 'border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.03]'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold">{h.name}</p>
                      <p className="text-[10px] opacity-75">
                        {h.completedThisWeek}/{h.weekly_target} sem.
                      </p>
                    </div>
                    {h.doneToday ? (
                      <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                    ) : (
                      <Plus className="h-4 w-4 shrink-0 opacity-60" />
                    )}
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        {/* TAB 2: AGENDA & TAREFAS */}
        {tab === 'agenda' && (
          <>
            <section className={card}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold">Próximos 14 dias</h2>
                <button
                  type="button"
                  onClick={() => setSheet('event')}
                  className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white"
                >
                  + Compromisso
                </button>
              </div>
              {upcomingEvents.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-500">
                  Sem compromissos agendados nos próximos 14 dias.
                </p>
              ) : (
                <ul className="space-y-2">
                  {upcomingEvents.map((ev) => (
                    <li
                      key={ev.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 dark:bg-white/[0.04]"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="h-9 w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: ev.color }}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{ev.title}</p>
                          <p className="text-[11px] text-slate-500">
                            {formatDateBR(ev.start_at.slice(0, 10))} ·{' '}
                            {formatTimeBR(ev.start_at)} – {formatTimeBR(ev.end_at)}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={card}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold">Todas as Tarefas ({allTasks.length})</h2>
                <button
                  type="button"
                  onClick={() => setSheet('task')}
                  className="text-xs font-semibold text-indigo-500"
                >
                  + Nova
                </button>
              </div>
              <ul className="space-y-2">
                {allTasks.slice(0, 25).map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => handleToggleTask(t.id)}
                      className="flex w-full items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-left dark:bg-white/[0.04]"
                    >
                      {t.status === 'done' ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                      ) : (
                        <Circle className="h-5 w-5 shrink-0 text-slate-400" />
                      )}
                      <span
                        className={`flex-1 text-sm ${
                          t.status === 'done' ? 'line-through opacity-50' : 'font-medium'
                        }`}
                      >
                        {t.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        {/* TAB 3: FINANÇAS */}
        {tab === 'finance' && (
          <>
            <section className="rounded-2xl bg-gradient-to-br from-indigo-600 to-sky-600 p-5 text-white shadow-lg">
              <p className="text-xs font-medium opacity-85">Saldo Registrado Total</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">
                {formatBRL(snapshot.totalBalance)}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/20 pt-3 text-xs">
                <div>
                  <p className="opacity-75">Receitas (mês)</p>
                  <p className="mt-0.5 text-sm font-bold tabular-nums">
                    +{formatBRL(snapshot.monthlyFinance.realizedIncome)}
                  </p>
                </div>
                <div>
                  <p className="opacity-75">Despesas (mês)</p>
                  <p className="mt-0.5 text-sm font-bold tabular-nums">
                    -{formatBRL(snapshot.monthlyFinance.realizedExpense)}
                  </p>
                </div>
              </div>
            </section>

            <section className={card}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold">Últimos Lançamentos</h2>
                <button
                  type="button"
                  onClick={() => setSheet('transaction')}
                  className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white"
                >
                  + Lançar
                </button>
              </div>
              {transactions.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-500">
                  Nenhuma transação registrada ainda.
                </p>
              ) : (
                <ul className="space-y-2">
                  {transactions.slice(0, 20).map((tx) => (
                    <li
                      key={tx.id}
                      className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/[0.04]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{tx.description}</p>
                        <p className="text-[11px] text-slate-500">
                          {formatDateBR(tx.date)} · {tx.status === 'planned' ? 'Previsto' : 'Realizado'}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-sm font-bold tabular-nums ${
                          tx.type === 'income'
                            ? 'text-emerald-500'
                            : tx.type === 'expense'
                              ? 'text-rose-500'
                              : 'text-sky-400'
                        }`}
                      >
                        {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
                        {formatBRL(tx.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {/* TAB 4: TRABALHO UBER / 99 MOTO */}
        {tab === 'work' && (
          <>
            <section className="rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 p-5 text-white shadow-lg">
              <p className="text-xs font-medium opacity-85">Líquido Operacional (Semana)</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">
                {formatBRL(snapshot.workWeek.totalOperationalNet)}
              </p>
              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/20 pt-3 text-xs">
                <div>
                  <p className="opacity-75">Bruto</p>
                  <p className="font-bold tabular-nums">{formatBRL(snapshot.workWeek.totalGross)}</p>
                </div>
                <div>
                  <p className="opacity-75">Combustível</p>
                  <p className="font-bold tabular-nums">{formatBRL(snapshot.workWeek.totalFuelCost)}</p>
                </div>
                <div>
                  <p className="opacity-75">Distância</p>
                  <p className="font-bold tabular-nums">{formatNumber(snapshot.workWeek.totalKm, 0)} km</p>
                </div>
              </div>
            </section>

            <section className={card}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold">Histórico de Jornadas</h2>
                <button
                  type="button"
                  onClick={() => setSheet('work')}
                  className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
                >
                  + Jornada
                </button>
              </div>
              {sessions.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-500">
                  Registre sua primeira jornada Uber Moto ou 99Moto.
                </p>
              ) : (
                <ul className="space-y-2">
                  {sessions.slice(0, 15).map((s) => {
                    const m = calculateWorkSessionMetrics(s);
                    return (
                      <li
                        key={s.id}
                        className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/[0.04]"
                      >
                        <div>
                          <p className="text-sm font-semibold">{PLATFORM_LABELS[s.platform]}</p>
                          <p className="text-[11px] text-slate-500">
                            {formatDateBR(s.date)} · {formatNumber(s.km_total, 0)} km · Bruto{' '}
                            {formatBRL(s.gross_amount)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold tabular-nums text-emerald-500">
                            {formatBRL(m.operationalNet)}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {formatBRL(m.operationalNetPerHour)}/h
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}

        {/* TAB 5: SYNC CLOUDFLARE & MAIS */}
        {tab === 'sync' && (
          <>
            <section className={card}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isSyncedConfigured ? (
                    <Cloud className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <CloudOff className="h-5 w-5 text-slate-400" />
                  )}
                  <div>
                    <h2 className="text-sm font-bold">Sincronização Cloudflare Free</h2>
                    <p className="text-[11px] text-slate-500">
                      Criptografia ponta a ponta AES-256-GCM
                    </p>
                  </div>
                </div>
                {syncConfig.lastRevision > 0 && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-500">
                    Rev. {syncConfig.lastRevision}
                  </span>
                )}
              </div>

              <form onSubmit={handleSaveAndSync} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold">
                    URL do seu Worker Cloudflare
                  </label>
                  <input
                    required
                    type="url"
                    value={syncUrlInput}
                    onChange={(e) => setSyncUrlInput(e.target.value)}
                    placeholder="https://lifehub-sync.sua-conta.workers.dev"
                    className={input}
                  />
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="block text-xs font-semibold">
                      Chave Secreta do Cofre (mesma do Desktop)
                    </label>
                    {syncKeyInput.trim().length >= 8 && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(syncKeyInput.trim());
                            showToast('Chave Secreta copiada!');
                          } catch {
                            showToast('Não foi possível copiar automaticamente.', 'err');
                          }
                        }}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-500"
                      >
                        <Copy className="h-3 w-3" /> Copiar
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      required
                      minLength={8}
                      type={showKey ? 'text' : 'password'}
                      value={syncKeyInput}
                      onChange={(e) => setSyncKeyInput(e.target.value)}
                      placeholder="LH-XXXX-XXXX-XXXX-XXXX"
                      className={`${input} pr-10 font-mono`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((s) => !s)}
                      className="absolute right-2.5 top-2.5 text-slate-400"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={syncConfig.autoSync !== false}
                    onChange={(e) => {
                      const nextCfg: CloudSyncConfig = {
                        ...syncConfig,
                        autoSync: e.target.checked,
                      };
                      saveCloudSyncConfig(nextCfg);
                      setSyncConfig(nextCfg);
                      showToast(
                        e.target.checked
                          ? 'Auto-sync ativado a cada ação.'
                          : 'Auto-sync pausado (somente manual).',
                      );
                    }}
                    className="h-4 w-4 rounded"
                  />
                  <span>Sincronizar automaticamente a cada ação</span>
                </label>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleTestServer}
                    className="flex-1 rounded-xl border border-slate-200 py-2.5 text-xs font-semibold dark:border-white/10"
                  >
                    Testar URL
                  </button>
                  <button
                    type="submit"
                    disabled={syncing}
                    className="flex-[2] rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white shadow-sm disabled:opacity-50"
                  >
                    {syncing ? 'Sincronizando...' : 'Salvar e Sincronizar Agora'}
                  </button>
                </div>

                {syncConfig.lastSyncedAt && (
                  <p className="text-center text-[11px] text-slate-500">
                    Último sync: {new Date(syncConfig.lastSyncedAt).toLocaleString('pt-BR')}
                  </p>
                )}
              </form>

              <div className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-500/10 p-3 text-[11px] text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Seus dados são criptografados no celular antes de enviar ao Cloudflare. Ninguém sem sua Chave Secreta consegue lê-los.
                </span>
              </div>
            </section>

            {/* Quick Ideas capture */}
            <section className={card}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-amber-500" />
                  <h2 className="text-sm font-bold">Ideias ({ideas.length})</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSheet('idea')}
                  className="text-xs font-semibold text-indigo-500"
                >
                  + Capturar
                </button>
              </div>
              {ideas.length === 0 ? (
                <p className="text-xs text-slate-500">Nenhuma ideia salva ainda.</p>
              ) : (
                <ul className="space-y-1.5">
                  {ideas.slice(0, 6).map((i) => (
                    <li
                      key={i.id}
                      className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-medium dark:bg-white/[0.04]"
                    >
                      {i.title}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Install guide iPhone + Android */}
            <section className={card}>
              <div className="mb-2 flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-indigo-500" />
                <h2 className="text-sm font-bold">Instalar como App (Grátis)</h2>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                <li>
                  <strong>iPhone (Safari):</strong> toque no ícone <em>Compartilhar</em> (quadrado com seta) → <strong>Adicionar à Tela de Início</strong>.
                </li>
                <li>
                  <strong>Android (Chrome):</strong> toque no menu <em>⋮</em> → <strong>Instalar aplicativo</strong>.
                </li>
              </ul>
            </section>
          </>
        )}
      </main>

      {/* Floating Quick-Add Button (+) */}
      <button
        type="button"
        onClick={() =>
          setSheet(
            tab === 'finance'
              ? 'transaction'
              : tab === 'work'
                ? 'work'
                : tab === 'agenda'
                  ? 'event'
                  : 'transaction',
          )
        }
        aria-label="Lançamento rápido"
        className="fixed right-4 bottom-24 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-xl shadow-indigo-600/35 transition active:scale-90"
      >
        <Plus className="h-6 w-6" />
      </button>

      {/* Native-Feel Bottom Tab Bar */}
      <nav
        aria-label="Navegação inferior"
        className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-slate-200/80 bg-white/95 px-2 pt-2 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#0b1120]/95"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {(
            [
              ['today', 'Hoje', Home],
              ['agenda', 'Agenda', CalendarDays],
              ['finance', 'Finanças', Wallet],
              ['work', 'Apps', Bike],
              ['sync', 'Sync', Cloud],
            ] as Array<[MobileTab, string, React.FC<{ className?: string }>]>
          ).map(([id, label, Icon]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex flex-col items-center gap-1 py-1 text-[10px] font-semibold transition ${
                  active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Bottom Sheet for 5-second Quick Entry */}
      {sheet && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSheet(null);
          }}
        >
          <div className="safe-bottom animate-sheet-up w-full max-w-lg rounded-t-3xl border-t border-slate-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex gap-1.5 overflow-x-auto">
                {(
                  [
                    ['transaction', 'Gasto/Rec'],
                    ['work', 'Uber/99'],
                    ['task', 'Tarefa'],
                    ['event', 'Evento'],
                    ['idea', 'Ideia'],
                  ] as Array<[Exclude<QuickSheetKind, null>, string]>
                ).map(([k, lbl]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSheet(k)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      sheet === k
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSheet(null)}
                className="rounded-full p-1.5 text-slate-400"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {sheet === 'transaction' && (
              <form onSubmit={handleCreateTransaction} className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {(['expense', 'income'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTxType(t)}
                      className={`rounded-xl py-2 text-xs font-bold ${
                        txType === t
                          ? t === 'expense'
                            ? 'bg-rose-600 text-white'
                            : 'bg-emerald-600 text-white'
                          : 'bg-slate-100 dark:bg-white/[0.06]'
                      }`}
                    >
                      {t === 'expense' ? 'Despesa' : 'Receita'}
                    </button>
                  ))}
                </div>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0.01"
                  inputMode="decimal"
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  placeholder="Valor (R$) ex.: 45.00"
                  className={`${input} text-lg font-bold`}
                />
                <input
                  required
                  value={txDesc}
                  onChange={(e) => setTxDesc(e.target.value)}
                  placeholder="Descrição (ex.: Combustível, Almoço)"
                  className={input}
                />
                <div className="grid grid-cols-2 gap-2">
                  <select value={txAccount} onChange={(e) => setTxAccount(e.target.value)} className={input}>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <select value={txCategory} onChange={(e) => setTxCategory(e.target.value)} className={input}>
                    {categories
                      .filter((c) => c.kind === 'both' || c.kind === txType)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white"
                >
                  Salvar Lançamento
                </button>
              </form>
            )}

            {sheet === 'work' && (
              <form onSubmit={handleCreateWork} className="space-y-3">
                <div className="grid grid-cols-3 gap-1.5">
                  {(['uber_moto', '99_moto', 'ambos'] as WorkPlatform[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setWsPlatform(p)}
                      className={`rounded-xl py-2 text-xs font-bold ${
                        wsPlatform === p
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 dark:bg-white/[0.06]'
                      }`}
                    >
                      {p === 'uber_moto' ? 'Uber Moto' : p === '99_moto' ? '99Moto' : 'Ambos'}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    required
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={wsGross}
                    onChange={(e) => setWsGross(e.target.value)}
                    placeholder="Bruto R$"
                    className={input}
                  />
                  <input
                    required
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    value={wsKm}
                    onChange={(e) => setWsKm(e.target.value)}
                    placeholder="KM"
                    className={input}
                  />
                  <input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={wsFuel}
                    onChange={(e) => setWsFuel(e.target.value)}
                    placeholder="Comb. R$"
                    className={input}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="time" value={wsStart} onChange={(e) => setWsStart(e.target.value)} className={input} />
                  <input type="time" value={wsEnd} onChange={(e) => setWsEnd(e.target.value)} className={input} />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={wsSyncFin}
                    onChange={(e) => setWsSyncFin(e.target.checked)}
                    className="h-4 w-4 rounded"
                  />
                  Lançar também no Financeiro
                </label>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white"
                >
                  Registrar Jornada
                </button>
              </form>
            )}

            {sheet === 'task' && (
              <form onSubmit={handleCreateTask} className="space-y-3">
                <input
                  required
                  value={tkTitle}
                  onChange={(e) => setTkTitle(e.target.value)}
                  placeholder="O que precisa fazer hoje?"
                  className={input}
                />
                <div className="grid grid-cols-3 gap-2">
                  {(['high', 'medium', 'low'] as TaskPriority[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setTkPriority(p)}
                      className={`rounded-xl py-2 text-xs font-bold ${
                        tkPriority === p
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 dark:bg-white/[0.06]'
                      }`}
                    >
                      {p === 'high' ? 'Alta' : p === 'medium' ? 'Média' : 'Baixa'}
                    </button>
                  ))}
                </div>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white"
                >
                  Adicionar Tarefa
                </button>
              </form>
            )}

            {sheet === 'event' && (
              <form onSubmit={handleCreateEvent} className="space-y-3">
                <input
                  required
                  value={evTitle}
                  onChange={(e) => setEvTitle(e.target.value)}
                  placeholder="Título do compromisso"
                  className={input}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={evDate} onChange={(e) => setEvDate(e.target.value)} className={input} />
                  <select
                    value={evCat}
                    onChange={(e) => setEvCat(e.target.value as EventCategory)}
                    className={input}
                  >
                    {Object.entries(EVENT_CATEGORY_META).map(([k, m]) => (
                      <option key={k} value={k}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="time" value={evStart} onChange={(e) => setEvStart(e.target.value)} className={input} />
                  <input type="time" value={evEnd} onChange={(e) => setEvEnd(e.target.value)} className={input} />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white"
                >
                  Salvar Compromisso
                </button>
              </form>
            )}

            {sheet === 'idea' && (
              <form onSubmit={handleCreateIdea} className="space-y-3">
                <input
                  required
                  value={ideaTitle}
                  onChange={(e) => setIdeaTitle(e.target.value)}
                  placeholder="Qual ideia surgiu agora?"
                  className={input}
                />
                <button
                  type="submit"
                  className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white"
                >
                  Capturar Ideia
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Mobile Gemini AI Drawer Sheet */}
      {aiOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAiOpen(false);
          }}
        >
          <div className="safe-bottom animate-sheet-up flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-3xl border-t border-slate-200 bg-white p-4 shadow-2xl dark:border-white/10 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                <h2 className="text-sm font-bold">Assistente IA · Gemini</h2>
              </div>
              <button
                type="button"
                onClick={() => setAiOpen(false)}
                className="rounded-full p-1 text-slate-400"
                aria-label="Fechar IA"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {!aiConfig.apiKey ? (
              <form onSubmit={handleSaveMobileAiKey} className="space-y-3 py-2">
                <p className="text-xs text-slate-500 dark:text-slate-300">
                  Cole sua chave API Gemini do Google AI Studio (fica salva só neste celular) para lançar corridas, gastos e tarefas por frase natural:
                </p>
                <input
                  required
                  type="password"
                  value={aiKeyInput}
                  onChange={(e) => setAiKeyInput(e.target.value)}
                  placeholder="Chave API Gemini (AQ... ou AIza...)"
                  className={`${input} font-mono`}
                />
                <button
                  type="submit"
                  className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white"
                >
                  Ativar IA no Celular
                </button>
              </form>
            ) : (
              <>
                <div className="mb-3 flex-1 space-y-2.5 overflow-y-auto pr-1">
                  {aiMessages.length === 0 && (
                    <div className="space-y-1.5">
                      {[
                        'Resuma meu dia e prioridades',
                        'Rodei 80 km na Uber Moto, fiz 180 bruto e 30 de gasolina',
                        'Gastei 35 reais no mercado hoje',
                      ].map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => handleSendMobileAi(q)}
                          className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs dark:border-white/10 dark:bg-white/[0.04]"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}

                  {aiMessages.map((m) => (
                    <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div
                        className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                          m.role === 'user'
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 text-slate-900 dark:bg-white/[0.06] dark:text-slate-100'
                        }`}
                      >
                        {m.text}
                      </div>
                      {m.actions && m.actions.length > 0 && (
                        <div className="mt-1.5 w-[92%] space-y-1.5">
                          {m.actions.map((act) => {
                            const done = m.executedActionIds?.includes(act.id);
                            return (
                              <div
                                key={act.id}
                                className="flex items-center justify-between gap-2 rounded-xl border border-indigo-500/35 bg-indigo-500/10 px-3 py-2 text-xs"
                              >
                                <span className="font-semibold">{act.summary}</span>
                                {done ? (
                                  <span className="font-bold text-emerald-500">✓ Salvo</span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleExecuteMobileAiAction(m.id, act)}
                                    className="shrink-0 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white"
                                  >
                                    Salvar
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}

                  {aiLoading && (
                    <p className="text-xs text-slate-500">Consultando Gemini...</p>
                  )}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMobileAi(aiPrompt);
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Pergunte ou lance por frase..."
                    className={`${input} flex-1`}
                  />
                  <button
                    type="submit"
                    disabled={aiLoading || !aiPrompt.trim()}
                    className="rounded-xl bg-indigo-600 p-2.5 text-white disabled:opacity-40"
                    aria-label="Enviar"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Mobile Toast */}
      {toast && (
        <div
          className={`fixed top-16 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-xs font-bold text-white shadow-xl ${
            toast.kind === 'err' ? 'bg-rose-600' : 'bg-emerald-600'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
};
