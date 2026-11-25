import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getDatabase } from '../db/client';
import type { SqlExecutor } from '../db/types';
import { getSettings, updateSettings } from '../repositories/settingsRepo';
import {
  AutoSyncController,
  isCloudSyncReady,
  loadCloudSyncConfig,
  syncDatabaseWithCloud,
  type AutoSyncStatus,
} from '../services/cloudSync';
import {
  isGoogleSheetsReady,
  loadGoogleSheetsConfig,
  saveGoogleSheetsConfig,
  syncFinanceToGoogleSheets,
} from '../services/googleSheetsSync';
import {
  isFamilySyncReady,
  loadFamilyFinanceConfig,
  saveFamilyFinanceConfig,
  syncFamilyFinanceHub,
} from '../services/familyFinanceSync';
import { getSkinDefinition } from '../services/skins';
import type { Settings } from '../types/domain';

export type NavSection =
  | 'dashboard'
  | 'calendar'
  | 'finance'
  | 'work'
  | 'health'
  | 'family'
  | 'career'
  | 'ideas'
  | 'settings';

export type QuickActionType =
  | null
  | 'transaction'
  | 'work_session'
  | 'event'
  | 'task'
  | 'idea';

export interface ToastMessage {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

interface AppContextValue {
  db: SqlExecutor | null;
  settings: Settings | null;
  loading: boolean;
  initError: string | null;
  activeSection: NavSection;
  setActiveSection: (section: NavSection) => void;
  quickAction: QuickActionType;
  openQuickAction: (action: QuickActionType) => void;
  dataVersion: number;
  bumpDataVersion: (options?: { skipAutoSync?: boolean }) => void;
  reloadSettings: () => Promise<void>;
  patchSettings: (patch: Partial<Omit<Settings, 'id' | 'updated_at'>>) => Promise<void>;
  notify: (text: string, kind?: 'success' | 'error' | 'info') => void;
  toasts: ToastMessage[];
  autoSyncStatus: AutoSyncStatus;
  triggerCloudSync: (options?: { manual?: boolean }) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [db, setDb] = useState<SqlExecutor | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [quickAction, setQuickAction] = useState<QuickActionType>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [autoSyncStatus, setAutoSyncStatus] = useState<AutoSyncStatus>('idle');

  const autoSyncRef = useRef<AutoSyncController | null>(null);
  const sheetsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheetsInFlightRef = useRef(false);
  const familyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const familyInFlightRef = useRef(false);
  const lastFocusSyncAtRef = useRef(0);

  const scheduleFamilyHubSync = useCallback(() => {
    if (!db) return;
    const cfg = loadFamilyFinanceConfig();
    if (!isFamilySyncReady(cfg) || !cfg.autoSync) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (familyTimerRef.current) clearTimeout(familyTimerRef.current);
    familyTimerRef.current = setTimeout(async () => {
      familyTimerRef.current = null;
      if (familyInFlightRef.current) return;
      const latest = loadFamilyFinanceConfig();
      if (!isFamilySyncReady(latest) || !latest.autoSync) return;
      familyInFlightRef.current = true;
      try {
        const res = await syncFamilyFinanceHub(db, latest);
        saveFamilyFinanceConfig({
          ...latest,
          enabled: true,
          lastSyncedAt: res.syncedAt,
          lastRevision: res.revision,
        });
      } catch {
        // Silent background failure
      } finally {
        familyInFlightRef.current = false;
      }
    }, 2000);
  }, [db]);

  const scheduleGoogleSheetsSync = useCallback(() => {
    if (!db) return;
    const cfg = loadGoogleSheetsConfig();
    if (!isGoogleSheetsReady(cfg) || !cfg.autoSync) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (sheetsTimerRef.current) clearTimeout(sheetsTimerRef.current);
    sheetsTimerRef.current = setTimeout(async () => {
      sheetsTimerRef.current = null;
      if (sheetsInFlightRef.current) return;
      const latestCfg = loadGoogleSheetsConfig();
      if (!isGoogleSheetsReady(latestCfg) || !latestCfg.autoSync) return;
      sheetsInFlightRef.current = true;
      try {
        const res = await syncFinanceToGoogleSheets(db, latestCfg);
        saveGoogleSheetsConfig({
          ...latestCfg,
          enabled: true,
          lastSyncedAt: res.syncedAt,
          lastRowCount: res.transactionsCount + res.recurringCount + res.workSessionsCount,
        });
      } catch {
        // Silent background mirror failure; user can retry manually in Settings
      } finally {
        sheetsInFlightRef.current = false;
      }
    }, 2200);
  }, [db]);

  const notify = useCallback((text: string, kind: 'success' | 'error' | 'info' = 'success') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3800);
  }, []);

  const bumpDataVersion = useCallback(
    (options?: { skipAutoSync?: boolean }) => {
      setDataVersion((v) => v + 1);
      if (!options?.skipAutoSync) {
        autoSyncRef.current?.schedule();
        scheduleGoogleSheetsSync();
        scheduleFamilyHubSync();
      }
    },
    [scheduleGoogleSheetsSync, scheduleFamilyHubSync],
  );

  const reloadSettings = useCallback(async () => {
    if (!db) return;
    const fresh = await getSettings(db);
    setSettings(fresh);
  }, [db]);

  const patchSettings = useCallback(
    async (patch: Partial<Omit<Settings, 'id' | 'updated_at'>>) => {
      if (!db) return;
      const updated = await updateSettings(db, patch);
      setSettings(updated);
      const keys = Object.keys(patch);
      const onlyLocalVisual =
        keys.length > 0 && keys.every((k) => k === 'ui_skin' || k === 'theme');
      bumpDataVersion({ skipAutoSync: onlyLocalVisual });
    },
    [db, bumpDataVersion],
  );

  // Initialize local SQLite
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const database = await getDatabase();
        const loadedSettings = await getSettings(database);
        if (!active) return;
        setDb(database);
        setSettings(loadedSettings);
        setLoading(false);
      } catch (err) {
        if (!active) return;
        setInitError(err instanceof Error ? err.message : 'Erro ao inicializar banco local.');
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Automatic background E2EE Sync controller (on every action + startup + window focus/online)
  useEffect(() => {
    if (!db) return;
    const controller = new AutoSyncController({
      debounceMs: 1200,
      getConfig: () => loadCloudSyncConfig('Windows Desktop'),
      runSyncFn: (cfg) => syncDatabaseWithCloud(db, cfg),
      onStateChange: (st) => setAutoSyncStatus(st),
      onSynced: async (res) => {
        if (res.remoteHadData) {
          const fresh = await getSettings(db);
          setSettings(fresh);
          setDataVersion((v) => v + 1);
        }
      },
    });
    autoSyncRef.current = controller;

    // Initial silent pull/merge on app open
    const initialTimer = window.setTimeout(() => {
      const cfg = loadCloudSyncConfig('Windows Desktop');
      if (isCloudSyncReady(cfg) && cfg.autoSync !== false) {
        lastFocusSyncAtRef.current = Date.now();
        void controller.flushNow();
      }
    }, 1500);

    const handleResumeSync = () => {
      const now = Date.now();
      if (now - lastFocusSyncAtRef.current < 15_000) return;
      const cfg = loadCloudSyncConfig('Windows Desktop');
      if (isCloudSyncReady(cfg) && cfg.autoSync !== false) {
        lastFocusSyncAtRef.current = now;
        void controller.flushNow();
      }
    };

    const handleOnline = () => {
      const cfg = loadCloudSyncConfig('Windows Desktop');
      if (isCloudSyncReady(cfg) && cfg.autoSync !== false) {
        void controller.flushNow();
      }
    };

    window.addEventListener('focus', handleResumeSync);
    window.addEventListener('online', handleOnline);

    return () => {
      window.clearTimeout(initialTimer);
      window.removeEventListener('focus', handleResumeSync);
      window.removeEventListener('online', handleOnline);
      controller.dispose();
      autoSyncRef.current = null;
    };
  }, [db]);

  const triggerCloudSync = useCallback(
    async (options?: { manual?: boolean }) => {
      const cfg = loadCloudSyncConfig('Windows Desktop');
      if (!isCloudSyncReady(cfg)) {
        if (options?.manual) {
          setActiveSection('settings');
          notify(
            'Configure a URL do Cloudflare e a Chave Secreta em Configurações para ativar o Sync.',
            'info',
          );
        }
        return;
      }
      if (!autoSyncRef.current) return;
      try {
        const res = await autoSyncRef.current.flushNow(Boolean(options?.manual));
        if (options?.manual && res) {
          notify(`Sincronizado com celular (rev. ${res.revision}).`);
        }
      } catch (err) {
        if (options?.manual) {
          notify(err instanceof Error ? err.message : 'Erro ao sincronizar.', 'error');
        }
      }
    },
    [notify],
  );

  useEffect(() => {
    const root = document.documentElement;
    if (settings?.theme === 'light') {
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
    }
    const skinDef = getSkinDefinition(settings?.ui_skin);
    root.dataset.skin = skinDef.id;
    root.dataset.shell = skinDef.shell;
    root.dataset.dashboard = skinDef.dashboard;
  }, [settings?.theme, settings?.ui_skin]);

  return (
    <AppContext.Provider
      value={{
        db,
        settings,
        loading,
        initError,
        activeSection,
        setActiveSection,
        quickAction,
        openQuickAction: setQuickAction,
        dataVersion,
        bumpDataVersion,
        reloadSettings,
        patchSettings,
        notify,
        toasts,
        autoSyncStatus,
        triggerCloudSync,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp deve ser usado dentro de AppProvider');
  return ctx;
}
