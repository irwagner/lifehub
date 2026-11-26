import React, { useState } from 'react';
import { ArrowDownToLine, CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  CURRENT_APP_VERSION,
  GITHUB_RELEASES_PAGE,
  checkForGitHubUpdate,
  downloadAndInstallUpdate,
  selectPlatformUpdateAsset,
  type UpdateCheckResult,
} from '../services/updater';

export const AutoUpdatePanel: React.FC = () => {
  const { notify } = useApp();
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);

  const handleCheck = async () => {
    setChecking(true);
    try {
      const info = await checkForGitHubUpdate();
      setResult(info);
      if (info.hasUpdate) {
        notify(`Nova versão v${info.latestVersion} disponível! Toque em Atualizar Agora.`);
      } else {
        notify(`Você já está na versão mais recente (v${info.currentVersion}).`);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao verificar atualizações.', 'error');
    } finally {
      setChecking(false);
    }
  };

  const handleInstallPrimary = async (forceWindowsInstaller = false) => {
    if (!result) return;
    const picked = selectPlatformUpdateAsset(result);
    const asset = forceWindowsInstaller ? result.installerAsset : picked.asset;
    if (!asset) {
      notify('Arquivo de atualização não encontrado nessa release.', 'error');
      return;
    }
    setInstalling(true);
    setProgress(picked.platform === 'android' ? 0 : null);
    try {
      notify(`Baixando ${asset.name} (v${result.latestVersion}) direto no app...`, 'info');
      const msg = await downloadAndInstallUpdate(
        asset,
        forceWindowsInstaller || picked.isInstaller,
        (pct) => setProgress(pct),
      );
      notify(msg, 'info');
      setInstalling(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Falha ao aplicar atualização.', 'error');
      setInstalling(false);
      setProgress(null);
    }
  };

  const picked = result ? selectPlatformUpdateAsset(result) : null;

  return (
    <section className="lh-card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500">
            <ArrowDownToLine className="h-4 w-4" />
          </span>
          <div>
            <h3 className="font-semibold">Atualizações Automáticas no Próprio App</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Versão instalada: <strong>v{CURRENT_APP_VERSION}</strong> · O app avisa e atualiza direto em 1 toque (Windows e Android APK) sem precisar abrir o GitHub e sem perder seus dados SQLite.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={GITHUB_RELEASES_PAGE}
            target="_blank"
            rel="noreferrer"
            className="lh-btn-secondary"
          >
            <ExternalLink className="h-3.5 w-3.5" /> GitHub Releases
          </a>
          <button
            type="button"
            disabled={checking || installing}
            onClick={handleCheck}
            className="lh-btn-primary"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Verificando...' : 'Verificar Atualizações'}
          </button>
        </div>
      </div>

      {result && (
        <div
          className={`rounded-xl border p-3 text-xs ${
            result.hasUpdate
              ? 'border-emerald-500/35 bg-emerald-500/10'
              : 'border-slate-200/80 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03]'
          }`}
        >
          {result.hasUpdate ? (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold text-emerald-600 dark:text-emerald-300">
                  Nova versão disponível: {result.releaseName} (v{result.latestVersion})
                </p>
                <div className="flex flex-wrap gap-2">
                  {picked?.asset && (
                    <button
                      type="button"
                      disabled={installing}
                      onClick={() => handleInstallPrimary(false)}
                      className="lh-btn-primary"
                    >
                      <ArrowDownToLine className="h-3.5 w-3.5" />
                      {installing
                        ? progress !== null
                          ? `Baixando (${progress}%)...`
                          : 'Baixando e Aplicando...'
                        : 'Atualizar Agora (1 toque)'}
                    </button>
                  )}
                  {picked?.platform === 'windows' && result.installerAsset && (
                    <button
                      type="button"
                      disabled={installing}
                      onClick={() => handleInstallPrimary(true)}
                      className="lh-btn-secondary"
                    >
                      Baixar Instalador
                    </button>
                  )}
                </div>
              </div>
              {result.notes && (
                <p className="whitespace-pre-wrap opacity-80">{result.notes}</p>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                LifeHub está atualizado na última versão disponível (v{result.latestVersion}).
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
