import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  Copy,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { loadCloudSyncConfig } from '../services/cloudSync';
import {
  clearGoogleDriveSessionToken,
  generateGoogleDriveAppsScriptCode,
  generateGoogleDriveSecret,
  getGoogleDriveSessionToken,
  loadGoogleDriveConfig,
  resolveGoogleDrivePassphrase,
  saveGoogleDriveConfig,
  signInWithGoogleDriveOAuth,
  syncDatabaseWithGoogleDrive,
  testGoogleDriveAppsScript,
  type GoogleDriveSyncConfig,
  type GoogleDriveSyncMode,
} from '../services/googleDriveSync';

export const GoogleDriveSyncPanel: React.FC = () => {
  const { db, dataVersion, reloadSettings, bumpDataVersion, notify } = useApp();
  const [config, setConfig] = useState<GoogleDriveSyncConfig>(() => loadGoogleDriveConfig());
  const [mode, setMode] = useState<GoogleDriveSyncMode>(config.mode);
  const [autoSync, setAutoSync] = useState(config.autoSync);
  const [customPassphrase, setCustomPassphrase] = useState(config.customPassphrase);
  const [oauthClientId, setOauthClientId] = useState(config.oauthClientId);
  const [appsScriptUrl, setAppsScriptUrl] = useState(config.appsScriptUrl);
  const [appsScriptSecret, setAppsScriptSecret] = useState(config.appsScriptSecret);
  const [showSecrets, setShowSecrets] = useState(false);
  const [showScriptCode, setShowScriptCode] = useState(false);
  const [oauthConnected, setOauthConnected] = useState(() => Boolean(getGoogleDriveSessionToken()));
  const [busy, setBusy] = useState(false);

  const inheritedCloudKey = useMemo(() => {
    void dataVersion;
    return loadCloudSyncConfig().passphrase.trim();
  }, [dataVersion]);

  const effectivePassphraseReady = useMemo(() => {
    return customPassphrase.trim().length >= 8 || inheritedCloudKey.length >= 8;
  }, [customPassphrase, inheritedCloudKey]);

  const generatedCode = useMemo(
    () =>
      generateGoogleDriveAppsScriptCode(
        appsScriptSecret.trim() || 'SEU-TOKEN-SECRETO',
        config.driveFolderName || 'LifeHub',
        config.driveFileName || 'lifehub-vault-e2ee.json',
      ),
    [appsScriptSecret, config.driveFolderName, config.driveFileName],
  );

  if (!db) return null;

  const persistForm = (overrides?: Partial<GoogleDriveSyncConfig>): GoogleDriveSyncConfig => {
    const next: GoogleDriveSyncConfig = {
      ...config,
      mode,
      autoSync,
      customPassphrase: customPassphrase.trim(),
      oauthClientId: oauthClientId.trim(),
      appsScriptUrl: appsScriptUrl.trim(),
      appsScriptSecret: appsScriptSecret.trim(),
      enabled:
        mode === 'apps_script'
          ? Boolean(appsScriptUrl.trim() && appsScriptSecret.trim().length >= 6)
          : Boolean(oauthClientId.trim()),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
    saveGoogleDriveConfig(next);
    setConfig(next);
    return next;
  };

  const handleCopyScript = async () => {
    try {
      persistForm();
      await navigator.clipboard.writeText(generatedCode);
      notify('Código do Google Apps Script copiado! Cole em script.google.com e publique como App da Web.');
    } catch {
      setShowScriptCode(true);
      notify('Não foi possível copiar automaticamente — selecione o código exibido abaixo.', 'info');
    }
  };

  const handleGenerateSecret = () => {
    const nextSecret = generateGoogleDriveSecret();
    setAppsScriptSecret(nextSecret);
    persistForm({ appsScriptSecret: nextSecret });
    notify('Novo Token Secreto do Google Drive Vault gerado!');
  };

  const handleTestAppsScript = async () => {
    setBusy(true);
    try {
      persistForm({ mode: 'apps_script' });
      const res = await testGoogleDriveAppsScript(appsScriptUrl, appsScriptSecret);
      notify(res.message);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao testar Google Drive Vault.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setBusy(true);
    try {
      const saved = persistForm({ mode: 'oauth' });
      const auth = await signInWithGoogleDriveOAuth(saved.oauthClientId);
      setOauthConnected(true);
      const updated = persistForm({
        mode: 'oauth',
        enabled: true,
        googleUserEmail: auth.email ?? saved.googleUserEmail,
      });
      notify(
        auth.email
          ? `Conectado com Google (${auth.email})! Agora clique em Sincronizar no Google Drive.`
          : 'Login com Google concluído! Agora você pode sincronizar no Google Drive.',
      );
      if (resolveGoogleDrivePassphrase(updated).length >= 8) {
        const syncRes = await syncDatabaseWithGoogleDrive(db, updated, {
          accessToken: auth.accessToken,
        });
        persistForm({
          mode: 'oauth',
          enabled: true,
          googleUserEmail: auth.email ?? updated.googleUserEmail,
          driveFileId: syncRes.fileId ?? updated.driveFileId,
          lastSyncedAt: syncRes.syncedAt,
          lastRevision: syncRes.revision,
        });
        await reloadSettings();
        bumpDataVersion({ skipAutoSync: true });
        notify(
          syncRes.remoteHadData
            ? `Google Drive sincronizado e mesclado (rev. ${syncRes.revision} · ${syncRes.mergedRowCount} registros)!`
            : `Cofre E2EE criado na pasta LifeHub do seu Google Drive (rev. ${syncRes.revision})!`,
        );
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Falha no login com Google.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignOut = () => {
    clearGoogleDriveSessionToken();
    setOauthConnected(false);
    persistForm({ googleUserEmail: null });
    notify('Sessão Google encerrada neste dispositivo.', 'info');
  };

  const handleSyncDriveNow = async () => {
    setBusy(true);
    try {
      const activeCfg = persistForm();
      const res = await syncDatabaseWithGoogleDrive(db, activeCfg);
      persistForm({
        enabled: true,
        driveFileId: res.fileId ?? activeCfg.driveFileId,
        lastSyncedAt: res.syncedAt,
        lastRevision: res.revision,
      });
      await reloadSettings();
      bumpDataVersion({ skipAutoSync: true });
      notify(
        res.remoteHadData
          ? `Google Drive sincronizado (rev. ${res.revision}) · ${res.mergedRowCount} registros mesclados com E2EE!`
          : `Cofre E2EE criado no Google Drive (pasta ${activeCfg.driveFolderName} · rev. ${res.revision}).`,
      );
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Erro ao sincronizar com Google Drive.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="lh-card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
            <HardDrive className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-semibold">
              Banco de Dados no Google Drive (Login Google + Backup E2EE Redundante)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Cria e sincroniza um cofre criptografado (<code>lifehub-vault-e2ee.json</code>) na pasta <strong>LifeHub</strong> do seu próprio Google Drive — proteção total caso o Cloudflare tenha queda ou limite.
            </p>
          </div>
        </div>
        {config.lastRevision > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-500">
            <Cloud className="h-3.5 w-3.5" /> Drive Rev. {config.lastRevision}
          </span>
        )}
      </div>

      {/* Mode Switcher */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setMode('apps_script');
            persistForm({ mode: 'apps_script' });
          }}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
            mode === 'apps_script'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'border border-slate-300/70 text-slate-600 hover:bg-slate-200/50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5'
          }`}
        >
          <HardDrive className="h-3.5 w-3.5" />
          Drive Vault Direto (Sem OAuth · Recomendado p/ PC, Android & iOS)
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('oauth');
            persistForm({ mode: 'oauth' });
          }}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
            mode === 'oauth'
              ? 'bg-brand-600 text-white shadow-sm'
              : 'border border-slate-300/70 text-slate-600 hover:bg-slate-200/50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5'
          }`}
        >
          <LogIn className="h-3.5 w-3.5" />
          Entrar com Google (OAuth 2.0 · Drive API v3)
        </button>
      </div>

      {/* Mode B: Zero-OAuth Google Drive Vault via Apps Script */}
      {mode === 'apps_script' ? (
        <div className="space-y-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.04] p-3.5">
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            <strong>Funciona em 1 minuto no Windows, Android APK e iPhone IPA</strong> sem precisar criar app no Google Cloud nem aprovação OAuth. O arquivo fica salvo diretamente no <strong>seu Google Drive</strong> (pasta <code>LifeHub</code>), criptografado em AES-256-GCM antes de sair do aparelho.
          </p>

          <ol className="list-decimal space-y-1 pl-4 text-[11.5px] text-slate-600 dark:text-slate-300">
            <li>
              Clique em <strong>Copiar Código Apps Script</strong> abaixo e abra{' '}
              <a
                href="https://script.google.com"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-brand-500 underline"
              >
                script.google.com
              </a>{' '}
              (logado na sua conta Google).
            </li>
            <li>
              Crie um <strong>Novo projeto</strong>, cole o código, clique em <strong>Implantar → Nova implantação → App da Web</strong>.
            </li>
            <li>
              Escolha <strong>Executar como: Eu</strong> e <strong>Quem pode acessar: Qualquer pessoa</strong> (a segurança é garantida pelo Token Secreto + criptografia AES-256-GCM).
            </li>
            <li>Copie a URL gerada (termina em <code>/exec</code>) e cole abaixo.</li>
          </ol>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleCopyScript} className="lh-btn-secondary text-xs">
              <Copy className="h-3.5 w-3.5" /> Copiar Código Apps Script
            </button>
            <button
              type="button"
              onClick={() => setShowScriptCode((v) => !v)}
              className="lh-btn-secondary text-xs"
            >
              {showScriptCode ? 'Ocultar Código' : 'Ver Código'}
            </button>
          </div>

          {showScriptCode && (
            <pre className="max-h-56 overflow-auto rounded-xl border border-slate-700/60 bg-slate-950 p-3 font-mono text-[10.5px] text-emerald-300">
              {generatedCode}
            </pre>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium">
                URL do Web App do Google Apps Script
              </label>
              <input
                type="url"
                value={appsScriptUrl}
                onChange={(e) => setAppsScriptUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="lh-input font-mono text-xs"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium">Token Secreto</label>
                <button
                  type="button"
                  onClick={handleGenerateSecret}
                  className="text-[11px] font-semibold text-brand-500 hover:underline"
                >
                  Gerar
                </button>
              </div>
              <div className="relative">
                <input
                  type={showSecrets ? 'text' : 'password'}
                  value={appsScriptSecret}
                  onChange={(e) => setAppsScriptSecret(e.target.value)}
                  className="lh-input pr-9 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowSecrets((s) => !s)}
                  className="absolute right-2.5 top-2.5 text-slate-400"
                >
                  {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Mode A: Google OAuth 2.0 Login + Google Drive REST API v3 */
        <div className="space-y-3 rounded-2xl border border-brand-500/25 bg-brand-500/[0.04] p-3.5">
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            Usa o login oficial do Google com permissão restrita <code>drive.file</code> (o LifeHub só enxerga a própria pasta <code>LifeHub</code> criada por ele). Para ativar, crie um <strong>OAuth Client ID (Aplicativo da Web)</strong> gratuito no{' '}
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-brand-500 underline"
            >
              Google Cloud Console
            </a>{' '}
            com a API <strong>Google Drive API</strong> ativada.
          </p>

          <div>
            <label className="mb-1 block text-xs font-medium">
              Google OAuth 2.0 Client ID (Web)
            </label>
            <input
              value={oauthClientId}
              onChange={(e) => setOauthClientId(e.target.value)}
              placeholder="1234567890-xxxx.apps.googleusercontent.com"
              className="lh-input font-mono text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={handleGoogleSignIn}
              className="lh-btn-primary"
            >
              <LogIn className="h-3.5 w-3.5" />
              {oauthConnected ? 'Reconectar com Google' : 'Entrar com Google e Sincronizar'}
            </button>
            {oauthConnected && (
              <button
                type="button"
                disabled={busy}
                onClick={handleGoogleSignOut}
                className="lh-btn-secondary text-xs"
              >
                <LogOut className="h-3.5 w-3.5" /> Desconectar sessão
              </button>
            )}
            {config.googleUserEmail && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-500">
                <CheckCircle2 className="h-3.5 w-3.5" /> {config.googleUserEmail}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Shared E2EE Passphrase & Redundant Auto-Sync */}
      <div className="space-y-2.5">
        <div>
          <label className="mb-1 flex items-center gap-1.5 text-xs font-medium">
            <KeyRound className="h-3.5 w-3.5 text-brand-500" />
            Chave E2EE do Cofre no Google Drive (opcional — se vazio, reutiliza sua Chave Secreta do Cloudflare acima)
          </label>
          <input
            type={showSecrets ? 'text' : 'password'}
            value={customPassphrase}
            onChange={(e) => setCustomPassphrase(e.target.value)}
            placeholder={
              inheritedCloudKey
                ? 'Usando automaticamente a mesma Chave Secreta do Cloudflare Sync'
                : 'Informe uma chave secreta de 8+ caracteres'
            }
            className="lh-input font-mono text-xs"
          />
          {!effectivePassphraseReady && (
            <p className="mt-1 text-[11px] text-amber-500">
              Gere uma Chave Secreta no painel Cloudflare acima ou digite uma chave de 8+ caracteres aqui.
            </p>
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={autoSync}
            onChange={(e) => {
              const checked = e.target.checked;
              setAutoSync(checked);
              persistForm({ autoSync: checked });
            }}
            className="h-4 w-4 rounded"
          />
          <span>
            <strong>Espelhar automaticamente no Google Drive (redundância anti-queda)</strong> — mantém uma cópia criptografada sempre em dia no Drive além do Cloudflare.
          </span>
        </label>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          disabled={busy || !effectivePassphraseReady}
          onClick={handleSyncDriveNow}
          className="lh-btn-primary"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
          {busy ? 'Sincronizando Drive...' : 'Sincronizar / Restaurar do Google Drive'}
        </button>

        {mode === 'apps_script' && (
          <button
            type="button"
            disabled={busy || !appsScriptUrl.trim()}
            onClick={handleTestAppsScript}
            className="lh-btn-secondary"
          >
            <Wifi className="h-3.5 w-3.5" /> Testar Conexão Drive
          </button>
        )}
      </div>

      {config.lastSyncedAt && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Último backup/sync no Google Drive:{' '}
          <strong>{new Date(config.lastSyncedAt).toLocaleString('pt-BR')}</strong>
        </p>
      )}

      <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3 text-xs text-slate-600 dark:text-slate-300">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        <p>
          <strong>Dupla garantia contra perda de dados:</strong> mesmo se o Cloudflare ficar fora do ar ou bater algum limite gratuito, seu banco inteiro (finanças, parcelas, recorrências, agenda, ideias e memória da IA) continua salvo no <strong>seu Google Drive</strong> criptografado com AES-256-GCM e pronto para restaurar em qualquer dispositivo.
        </p>
      </div>
    </section>
  );
};
