import React, { useState } from 'react';
import { Cloud, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  loadCloudSyncConfig,
  saveCloudSyncConfig,
  syncDatabaseWithCloud,
} from '../services/cloudSync';

export const CloudSyncQuickButton: React.FC = () => {
  const { db, reloadSettings, bumpDataVersion, setActiveSection, notify } = useApp();
  const [syncing, setSyncing] = useState(false);

  const cfg = loadCloudSyncConfig('Windows Desktop');
  const configured = Boolean(cfg.endpointUrl && cfg.passphrase);

  const handleClick = async () => {
    if (!configured) {
      setActiveSection('settings');
      notify('Configure a URL do Cloudflare e a Chave Secreta em Configurações para ativar o Sync.', 'info');
      return;
    }
    if (!db || syncing) return;
    setSyncing(true);
    try {
      const res = await syncDatabaseWithCloud(db, cfg);
      saveCloudSyncConfig({
        ...cfg,
        enabled: true,
        lastSyncedAt: res.syncedAt,
        lastRevision: res.revision,
      });
      await reloadSettings();
      bumpDataVersion();
      notify(`Sincronizado com celular (rev. ${res.revision}).`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao sincronizar.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <button
      type="button"
      disabled={syncing}
      onClick={handleClick}
      title={
        configured
          ? 'Sincronizar com celular via Cloudflare E2EE'
          : 'Configurar sincronização gratuita com iPhone / Android'
      }
      aria-label="Sincronizar com celular"
      className="lh-control-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium shadow-sm"
    >
      {syncing ? (
        <RefreshCw className="h-3.5 w-3.5 animate-spin text-brand-500" />
      ) : (
        <Cloud className={`h-3.5 w-3.5 ${configured ? 'text-emerald-500' : 'opacity-65'}`} />
      )}
      <span className="hidden md:inline">{syncing ? 'Sync...' : 'Celular'}</span>
    </button>
  );
};
