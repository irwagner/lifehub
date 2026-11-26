import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { getDatabase } from '../db/client';
import type { SqlExecutor } from '../db/types';
import { getSettings, updateSettings } from '../repositories/settingsRepo';
import {
  AutoSyncController,
  isCloudSyncReady,
  loadCloudSyncConfig,
  parseMobilePairingHash,
  saveCloudSyncConfig,
  syncDatabaseWithCloud,
  type AutoSyncStatus,
} from '../services/cloudSync';
import {
  loadGeminiAiConfig,
  saveGeminiAiConfig,
} from '../services/geminiAi';
import {
  isGoogleSheetsReady,
  loadGoogleSheetsConfig,
  saveGoogleSheetsConfig,
  syncFinanceToGoogleSheets,
} from '../services/googleSheetsSync';
import {
  isGoogleDriveReady,
  loadGoogleDriveConfig,
  saveGoogleDriveConfig,
  syncDatabaseWithGoogleDrive,
} from '../services/googleDriveSync';
import {
  isFamilySyncReady,
  loadFamilyFinanceConfig,
  parseFamilyInviteHash,
  saveFamilyFinanceConfig,
  syncFamilyFinanceHub,
} from '../services/familyFinanceSync';
import { getSkinDefinition } from '../services/skins';
import type { Settings } from '../types/domain';

function resolveDeviceName(): string {
  const plat = Capacitor.getPlatform();
  if (plat === 'android') return 'Android App';
  if (plat === 'ios') return 'iPhone App';
  return 'Windows Desktop';
}

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
  const driveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const driveInFlightRef = useRef(false);
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

  const scheduleGoogleDriveSync = useCallback(() => {
    if (!db) return;
    const cfg = loadGoogleDriveConfig();
    if (!isGoogleDriveReady(cfg) || !cfg.autoSync) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (driveTimerRef.current) clearTimeout(driveTimerRef.current);
    driveTimerRef.current = setTimeout(async () => {
      driveTimerRef.current = null;
      if (driveInFlightRef.current) return;
      const latestCfg = loadGoogleDriveConfig();
      if (!isGoogleDriveReady(latestCfg) || !latestCfg.autoSync) return;
      driveInFlightRef.current = true;
      try {
        const res = await syncDatabaseWithGoogleDrive(db, latestCfg, {
          deviceName: resolveDeviceName(),
        });
        saveGoogleDriveConfig({
          ...latestCfg,
          enabled: true,
          driveFileId: res.fileId ?? latestCfg.driveFileId,
          lastSyncedAt: res.syncedAt,
          lastRevision: res.revision,
        });
        if (res.remoteHadData) {
          const fresh = await getSettings(db);
          setSettings(fresh);
          setDataVersion((v) => v + 1);
        }
      } catch {
        // Silent background redundancy failure; user can retry manually in Settings
      } finally {
        driveInFlightRef.current = false;
      }
    }, 2800);
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
        scheduleGoogleDriveSync();
        scheduleGoogleSheetsSync();
        scheduleFamilyHubSync();
      }
    },
    [scheduleGoogleDriveSync, scheduleGoogleSheetsSync, scheduleFamilyHubSync],
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

  // Automatic background E2EE Sync controller (on every action + startup + window focus/visibility/online)
  useEffect(() => {
    if (!db) return;
    const deviceName = resolveDeviceName();
    const controller = new AutoSyncController({
      debounceMs: 1200,
      getConfig: () => loadCloudSyncConfig(deviceName),
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
      const cfg = loadCloudSyncConfig(deviceName);
      if (isCloudSyncReady(cfg) && cfg.autoSync !== false) {
        lastFocusSyncAtRef.current = Date.now();
        void controller.flushNow();
      }
    }, 1500);

    const handleResumeSync = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastFocusSyncAtRef.current < 15_000) return;
      const cfg = loadCloudSyncConfig(deviceName);
      if (isCloudSyncReady(cfg) && cfg.autoSync !== false) {
        lastFocusSyncAtRef.current = now;
        void controller.flushNow();
      }
    };

    const handleOnline = () => {
      const cfg = loadCloudSyncConfig(deviceName);
      if (isCloudSyncReady(cfg) && cfg.autoSync !== false) {
        void controller.flushNow();
      }
    };

    window.addEventListener('focus', handleResumeSync);
    document.addEventListener('visibilitychange', handleResumeSync);
    window.addEventListener('online', handleOnline);

    // Optional native deep link handling (lifehub://pair#pair=... or #family=...)
    let urlListenerHandle: { remove: () => Promise<void> } | null = null;
    const handleNativeUrl = async (rawUrl: string) => {
      const hashIdx = rawUrl.indexOf('#');
      if (hashIdx < 0) return;
      const hash = rawUrl.slice(hashIdx);

      const paired = parseMobilePairingHash(hash);
      if (paired) {
        const nextCfg = {
          ...loadCloudSyncConfig(deviceName),
          enabled: true,
          endpointUrl: paired.endpointUrl,
          passphrase: paired.passphrase,
          deviceName,
        };
        saveCloudSyncConfig(nextCfg);
        if (paired.geminiApiKey) {
          saveGeminiAiConfig({
            ...loadGeminiAiConfig(),
            apiKey: paired.geminiApiKey,
            updatedAt: new Date().toISOString(),
          });
        }
        notify('Link de pareamento detectado! Sincronizando...');
        try {
          await controller.flushNow(true);
        } catch {
          // user sees status
        }
        return;
      }

      const fam = parseFamilyInviteHash(hash);
      if (fam) {
        const nextFam = {
          ...loadFamilyFinanceConfig(),
          enabled: true,
          endpointUrl: fam.endpointUrl,
          familyKey: fam.familyKey,
        };
        saveFamilyFinanceConfig(nextFam);
        setActiveSection('finance');
        notify('Convite da Família detectado! Sincronizando...');
        try {
          const res = await syncFamilyFinanceHub(db, nextFam);
          saveFamilyFinanceConfig({
            ...nextFam,
            lastSyncedAt: res.syncedAt,
            lastRevision: res.revision,
          });
          setDataVersion((v) => v + 1);
          notify('Conectado ao Financeiro da Família!');
        } catch (err) {
          notify(err instanceof Error ? err.message : 'Erro ao sincronizar família.', 'error');
        }
      }
    };

    if (Capacitor.isNativePlatform()) {
      CapApp.getLaunchUrl()
        .then((res) => {
          if (res?.url) void handleNativeUrl(res.url);
        })
        .catch(() => {});
      CapApp.addListener('appUrlOpen', ({ url }) => {
        if (url) void handleNativeUrl(url);
      })
        .then((handle) => {
          urlListenerHandle = handle;
        })
        .catch(() => {});
    }

    return () => {
      window.clearTimeout(initialTimer);
      window.removeEventListener('focus', handleResumeSync);
      document.removeEventListener('visibilitychange', handleResumeSync);
      window.removeEventListener('online', handleOnline);
      if (urlListenerHandle) {
        void urlListenerHandle.remove();
      }
      controller.dispose();
      autoSyncRef.current = null;
    };
  }, [db, notify]);

  const triggerCloudSync = useCallback(
    async (options?: { manual?: boolean }) => {
      const cfg = loadCloudSyncConfig(resolveDeviceName());
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
          notify(`Sincronizado com a nuvem E2EE (rev. ${res.revision}).`);
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
    const isLight = settings?.theme === 'light';
    if (isLight) {
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
    }
    const skinDef = getSkinDefinition(settings?.ui_skin);
    root.dataset.skin = skinDef.id;
    root.dataset.shell = skinDef.shell;
    root.dataset.dashboard = skinDef.dashboard;

    if (Capacitor.isNativePlatform()) {
      StatusBar.setStyle({ style: isLight ? Style.Light : Style.Dark }).catch(() => {});
      if (Capacitor.getPlatform() === 'android') {
        StatusBar.setBackgroundColor({ color: isLight ? '#f4f6fb' : '#070b14' }).catch(() => {});
      }
    }
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
