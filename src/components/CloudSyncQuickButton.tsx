import React from 'react';
import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { isCloudSyncReady, loadCloudSyncConfig } from '../services/cloudSync';

export const CloudSyncQuickButton: React.FC = () => {
  const { autoSyncStatus, triggerCloudSync } = useApp();

  const cfg = loadCloudSyncConfig('Windows Desktop');
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
      className="lh-control-btn relative inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium shadow-sm"
    >
      {busy ? (
        <RefreshCw className="h-3.5 w-3.5 animate-spin text-brand-500" />
      ) : autoSyncStatus === 'offline' ? (
        <CloudOff className="h-3.5 w-3.5 text-amber-500" />
      ) : (
        <Cloud
          className={`h-3.5 w-3.5 ${
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
            : 'Celular'}
      </span>
      {autoEnabled && !busy && autoSyncStatus !== 'error' && autoSyncStatus !== 'offline' && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-emerald-500"
          title="Auto-sync ativo a cada ação"
        />
      )}
    </button>
  );
};
