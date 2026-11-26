import React from 'react';
import { Capacitor } from '@capacitor/core';
import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { isCloudSyncReady, loadCloudSyncConfig } from '../services/cloudSync';

export const CloudSyncQuickButton: React.FC = () => {
  const { autoSyncStatus, triggerCloudSync } = useApp();
  const isNativeMobile = Capacitor.isNativePlatform();
  const defaultDevice =
    Capacitor.getPlatform() === 'android'
      ? 'Android App'
      : Capacitor.getPlatform() === 'ios'
        ? 'iPhone App'
        : 'Windows Desktop';

  const cfg = loadCloudSyncConfig(defaultDevice);
  const configured = isCloudSyncReady(cfg);
  const autoEnabled = configured && cfg.autoSync !== false;
  const busy = autoSyncStatus === 'syncing' || autoSyncStatus === 'scheduled';

  const statusTitle = !configured
    ? 'Configurar sincronização gratuita com iPhone / Android'
    : autoSyncStatus === 'syncing'
      ? 'Sincronizando alterações com a nuvem...'
      : autoSyncStatus === 'scheduled'
        ? 'Alteração detectada — sincronizando em instantes...'
        : autoSyncStatus === 'offline'
          ? 'Sem internet — dados salvos localmente; sincronizará ao voltar online'
          : autoSyncStatus === 'error'
            ? 'Último auto-sync falhou — clique para tentar novamente'
            : autoEnabled
              ? `Auto-sync ativo (a cada ação · Rev. ${cfg.lastRevision}) · Clique para sincronizar agora`
              : 'Sincronizar manualmente com celular via Cloudflare E2EE';

  return (
    <button
      type="button"
      disabled={autoSyncStatus === 'syncing'}
      onClick={() => void triggerCloudSync({ manual: true })}
      title={statusTitle}
      aria-label="Sincronizar com celular"
      className="lh-control-btn relative inline-flex h-9 w-9 items-center justify-center gap-1.5 text-xs font-medium shadow-sm active:scale-95 md:w-auto md:px-2.5 md:py-1.5 lg:h-auto"
    >
      {busy ? (
        <RefreshCw className="h-4 w-4 animate-spin text-brand-500 lg:h-3.5 lg:w-3.5" />
      ) : autoSyncStatus === 'offline' ? (
        <CloudOff className="h-4 w-4 text-amber-500 lg:h-3.5 lg:w-3.5" />
      ) : (
        <Cloud
          className={`h-4 w-4 lg:h-3.5 lg:w-3.5 ${
            autoSyncStatus === 'error'
              ? 'text-rose-500'
              : configured
                ? 'text-emerald-500'
                : 'opacity-65'
          }`}
        />
      )}
      <span className="hidden md:inline">
        {autoSyncStatus === 'syncing'
          ? 'Sync...'
          : autoSyncStatus === 'scheduled'
            ? 'Salvando...'
            : isNativeMobile
              ? 'Sync'
              : 'Celular'}
      </span>
      {autoEnabled && !busy && autoSyncStatus !== 'error' && autoSyncStatus !== 'offline' && (
        <span
          className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-slate-900 md:static md:h-1.5 md:w-1.5 md:ring-0"
          title="Auto-sync ativo a cada ação"
        />
      )}
    </button>
  );
};
