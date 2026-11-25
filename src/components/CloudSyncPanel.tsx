import React, { useState } from 'react';
import {
  Cloud,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Wifi,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  buildMobilePairingUrl,
  generateSyncPassphrase,
  loadCloudSyncConfig,
  saveCloudSyncConfig,
  syncDatabaseWithCloud,
  testCloudSyncConnection,
  type CloudSyncConfig,
} from '../services/cloudSync';

export const CloudSyncPanel: React.FC = () => {
  const { db, reloadSettings, bumpDataVersion, notify } = useApp();
  const [config, setConfig] = useState<CloudSyncConfig>(() =>
    loadCloudSyncConfig('Windows Desktop'),
  );
  const [endpointUrl, setEndpointUrl] = useState(
    config.endpointUrl || 'https://lifehub-sync.irwagneremanoel.workers.dev',
  );
  const [passphrase, setPassphrase] = useState(config.passphrase);
  const [deviceName, setDeviceName] = useState(config.deviceName || 'Windows Desktop');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!db) return null;

  const persistForm = (overrides?: Partial<CloudSyncConfig>): CloudSyncConfig => {
    const next: CloudSyncConfig = {
      ...config,
      enabled: Boolean(endpointUrl.trim() && passphrase.trim()),
      endpointUrl: endpointUrl.trim(),
      passphrase: passphrase.trim(),
      deviceName: deviceName.trim() || 'Windows Desktop',
      ...overrides,
    };
    saveCloudSyncConfig(next);
    setConfig(next);
    return next;
  };

  const handleGenerateKey = () => {
    const generated = generateSyncPassphrase();
    setPassphrase(generated);
    setShowKey(true);
    notify('Nova Chave Secreta gerada. Salve/sincronize e use a mesma no celular.');
  };

  const handleTestConnection = async () => {
    setBusy(true);
    try {
      const res = await testCloudSyncConnection(endpointUrl);
      notify(res.message);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Não foi possível alcançar o Worker.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSyncNow = async () => {
    setBusy(true);
    try {
      const activeCfg = persistForm();
      const result = await syncDatabaseWithCloud(db, activeCfg);
      persistForm({
        enabled: true,
        lastSyncedAt: result.syncedAt,
        lastRevision: result.revision,
      });
      await reloadSettings();
      bumpDataVersion();
      notify(
        result.remoteHadData
          ? `Sincronização concluída (rev. ${result.revision}) · ${result.mergedRowCount} registros mesclados com segurança.`
          : `Primeiro envio concluído para o Cloudflare (rev. ${result.revision}).`,
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro durante a sincronização.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyPairingLink = async () => {
    try {
      const url = buildMobilePairingUrl(endpointUrl, passphrase);
      await navigator.clipboard.writeText(url);
      notify('Link de pareamento copiado! Abra no Safari (iPhone) ou Chrome (Android).');
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Preencha URL e Chave Secreta antes de copiar o link.',
        'error',
      );
    }
  };

  return (
    <section className="lh-card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-500/15 text-brand-500">
            <Smartphone className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-semibold">
              App Celular (iPhone & Android) + Sync Cloudflare Free
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sincronização opcional 100% gratuita via Cloudflare Workers + KV com criptografia ponta a ponta AES-256-GCM.
            </p>
          </div>
        </div>
        {config.lastRevision > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-500">
            <Cloud className="h-3.5 w-3.5" /> Rev. {config.lastRevision}
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium">
            URL do seu Worker Cloudflare (Free Tier)
          </label>
          <input
            type="url"
            value={endpointUrl}
            onChange={(e) => setEndpointUrl(e.target.value)}
            placeholder="https://lifehub-sync.sua-conta.workers.dev"
            className="lh-input"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Nome deste PC</label>
          <input
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            className="lh-input"
          />
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-medium">
            Chave Secreta do Cofre (E2EE — nunca enviada ao servidor)
          </label>
          <button
            type="button"
            onClick={handleGenerateKey}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-500 hover:underline"
          >
            <KeyRound className="h-3 w-3" /> Gerar Chave Segura
          </button>
        </div>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Mínimo 8 caracteres (ex.: LH-ABCD-1234-EFGH-5678)"
            className="lh-input pr-10 font-mono"
          />
          <button
            type="button"
            onClick={() => setShowKey((s) => !s)}
            aria-label="Mostrar ou ocultar chave"
            className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-200"
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          disabled={busy}
          onClick={handleSyncNow}
          className="lh-btn-primary"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
          {busy ? 'Sincronizando...' : 'Sincronizar Agora (Merge Seguro)'}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={handleTestConnection}
          className="lh-btn-secondary"
        >
          <Wifi className="h-3.5 w-3.5" /> Testar Conexão
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={handleCopyPairingLink}
          className="lh-btn-secondary"
        >
          <Copy className="h-3.5 w-3.5" /> Copiar Link para iPhone / Android
        </button>
      </div>

      {config.lastSyncedAt && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Última sincronização bem-sucedida:{' '}
          <strong>{new Date(config.lastSyncedAt).toLocaleString('pt-BR')}</strong>
        </p>
      )}

      <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3 text-xs text-slate-600 dark:text-slate-300">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        <div className="space-y-1">
          <p>
            <strong>Privacidade Zero-Knowledge:</strong> o Cloudflare guarda apenas o pacote criptografado (AES-256-GCM) e hospeda o app mobile PWA no mesmo link gratuito.
          </p>
          <p className="text-[11px] opacity-80">
            Para publicar de graça na sua conta Cloudflare, rode <code>npm run build:mobile</code> e depois <code>npm run deploy</code> dentro da pasta <code>cloudflare-sync/</code> (guia completo em <code>cloudflare-sync/README.md</code>).
          </p>
        </div>
      </div>
    </section>
  );
};
