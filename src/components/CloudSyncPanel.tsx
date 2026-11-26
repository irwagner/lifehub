import React, { useMemo, useState } from 'react';
import {
  Camera,
  Cloud,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Wifi,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { PairingQrCode } from './PairingQrCode';
import { QrCodeScannerModal, type ScannedPairingResult } from './QrCodeScannerModal';
import {
  buildMobilePairingUrl,
  generateSyncPassphrase,
  loadCloudSyncConfig,
  saveCloudSyncConfig,
  syncDatabaseWithCloud,
  testCloudSyncConnection,
  type CloudSyncConfig,
} from '../services/cloudSync';
import { loadGeminiAiConfig, saveGeminiAiConfig } from '../services/geminiAi';

const DEFAULT_SYNC_URL = 'https://lifehub-sync.irwagneremanoel.workers.dev';

function loadOrBootstrapSyncConfig(): CloudSyncConfig {
  const loaded = loadCloudSyncConfig('Windows Desktop');
  const nextUrl = loaded.endpointUrl.trim() || DEFAULT_SYNC_URL;
  const hasValidKey = loaded.passphrase.trim().length >= 8;
  if (hasValidKey && loaded.endpointUrl.trim()) {
    return loaded;
  }
  const bootstrapped: CloudSyncConfig = {
    ...loaded,
    enabled: true,
    autoSync: loaded.autoSync !== false,
    endpointUrl: nextUrl,
    passphrase: hasValidKey ? loaded.passphrase.trim() : generateSyncPassphrase(),
    deviceName: loaded.deviceName || 'Windows Desktop',
  };
  saveCloudSyncConfig(bootstrapped);
  return bootstrapped;
}

export const CloudSyncPanel: React.FC = () => {
  const { db, dataVersion, reloadSettings, bumpDataVersion, notify } = useApp();
  const [config, setConfig] = useState<CloudSyncConfig>(() => loadOrBootstrapSyncConfig());
  const [endpointUrl, setEndpointUrl] = useState(config.endpointUrl || DEFAULT_SYNC_URL);
  const [passphrase, setPassphrase] = useState(config.passphrase);
  const [deviceName, setDeviceName] = useState(config.deviceName || 'Windows Desktop');
  const [autoSync, setAutoSync] = useState(config.autoSync !== false);
  const [showKey, setShowKey] = useState(false);
  const [showQr, setShowQr] = useState(true);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const geminiApiKey = useMemo(() => {
    void dataVersion;
    return loadGeminiAiConfig().apiKey.trim();
  }, [dataVersion]);

  if (!db) return null;

  const persistForm = (overrides?: Partial<CloudSyncConfig>): CloudSyncConfig => {
    const next: CloudSyncConfig = {
      ...config,
      enabled: Boolean(endpointUrl.trim() && passphrase.trim()),
      autoSync,
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
    persistForm({ passphrase: generated, enabled: true });
    notify('Nova Chave Secreta gerada e aplicada ao QR Code!');
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
      bumpDataVersion({ skipAutoSync: true });
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

  const handleQrPaired = async (paired: ScannedPairingResult) => {
    setScannerOpen(false);
    setBusy(true);
    try {
      setEndpointUrl(paired.endpointUrl);
      setPassphrase(paired.passphrase);
      setAutoSync(true);
      const nextCfg = persistForm({
        enabled: true,
        autoSync: true,
        endpointUrl: paired.endpointUrl,
        passphrase: paired.passphrase,
      });

      if (paired.geminiApiKey) {
        const currentAi = loadGeminiAiConfig();
        saveGeminiAiConfig({
          ...currentAi,
          apiKey: paired.geminiApiKey,
          updatedAt: new Date().toISOString(),
        });
      }

      const result = await syncDatabaseWithCloud(db, nextCfg);
      persistForm({
        enabled: true,
        autoSync: true,
        endpointUrl: paired.endpointUrl,
        passphrase: paired.passphrase,
        lastSyncedAt: result.syncedAt,
        lastRevision: result.revision,
      });
      await reloadSettings();
      bumpDataVersion({ skipAutoSync: true });
      notify(
        paired.geminiApiKey
          ? `Pareado via QR Code (Sync + Chave IA) e sincronizado (rev. ${result.revision} · ${result.mergedRowCount} registros)!`
          : `Pareado via QR Code e sincronizado (rev. ${result.revision} · ${result.mergedRowCount} registros)!`,
      );
    } catch (err) {
      notify(
        err instanceof Error
          ? `QR lido, mas falhou ao sincronizar: ${err.message}`
          : 'Erro ao sincronizar após ler QR Code.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCopyPairingLink = async () => {
    try {
      persistForm();
      const url = buildMobilePairingUrl(endpointUrl, passphrase, { geminiApiKey });
      await navigator.clipboard.writeText(url);
      notify(
        geminiApiKey
          ? 'Link de pareamento (com Sync + chave IA) copiado! Abra no Safari ou Chrome.'
          : 'Link de pareamento copiado! Abra no Safari (iPhone) ou Chrome (Android).',
      );
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
              Sincronização opcional 100% gratuita via Cloudflare Workers + Durable Objects (Free Tier) com criptografia ponta a ponta AES-256-GCM.
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

      <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <input
          type="checkbox"
          checked={autoSync}
          onChange={(e) => {
            const checked = e.target.checked;
            setAutoSync(checked);
            persistForm({ autoSync: checked });
            notify(
              checked
                ? 'Auto-sync ativado: toda ação feita será sincronizada automaticamente.'
                : 'Auto-sync pausado (você ainda pode sincronizar manualmente).',
              'info',
            );
          }}
          className="h-4 w-4 rounded"
        />
        <span>
          <strong>Sincronizar automaticamente a cada ação</strong> (transações, IA, tarefas, jornadas e agenda sobem em ~1s em segundo plano).
        </span>
      </label>

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
          onClick={() => setScannerOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-500 transition hover:bg-emerald-500/25"
        >
          <Camera className="h-3.5 w-3.5" /> Escanear QR Code do PC
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => setShowQr((v) => !v)}
          className="lh-btn-secondary"
        >
          <QrCode className="h-3.5 w-3.5" />
          {showQr ? 'Ocultar QR Code' : 'Mostrar QR Code (iPhone / Android)'}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={handleCopyPairingLink}
          className="lh-btn-secondary"
        >
          <Copy className="h-3.5 w-3.5" /> Copiar Link
        </button>
      </div>

      {showQr && (
        <PairingQrCode
          endpointUrl={endpointUrl}
          passphrase={passphrase}
          geminiApiKey={geminiApiKey}
          hasSyncedOnce={config.lastRevision > 0}
          onGenerateKey={handleGenerateKey}
          onCopyLink={handleCopyPairingLink}
          onClose={() => setShowQr(false)}
        />
      )}

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
      <QrCodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onPaired={handleQrPaired}
      />
    </section>
  );
};
