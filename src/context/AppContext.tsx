import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getDatabase } from '../db/client';
import type { SqlExecutor } from '../db/types';
import { getSettings, updateSettings } from '../repositories/settingsRepo';
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
  bumpDataVersion: () => void;
  reloadSettings: () => Promise<void>;
  patchSettings: (patch: Partial<Omit<Settings, 'id' | 'updated_at'>>) => Promise<void>;
  notify: (text: string, kind?: 'success' | 'error' | 'info') => void;
  toasts: ToastMessage[];
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

  const notify = useCallback((text: string, kind: 'success' | 'error' | 'info' = 'success') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3800);
  }, []);

  const bumpDataVersion = useCallback(() => {
    setDataVersion((v) => v + 1);
  }, []);

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
      setDataVersion((v) => v + 1);
    },
    [db],
  );

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

  useEffect(() => {
    const root = document.documentElement;
    if (settings?.theme === 'light') {
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
    }
  }, [settings?.theme]);

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
