import React, { useEffect, useState } from 'react';
import { ArrowDownToLine, CheckCircle2, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  CURRENT_APP_VERSION,
  checkForGitHubUpdate,
  downloadAndInstallUpdate,
  resolveCurrentVersion,
  type UpdateCheckResult,
} from '../services/updater';

export const UpdateBadgeButton: React.FC = () => {
  const { notify, setActiveSection } = useApp();
  const [currentVersion, setCurrentVersion] = useState(CURRENT_APP_VERSION);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let active = true;
    resolveCurrentVersion()
      .then((v) => {
        if (active && v) setCurrentVersion(v);
      })
      .catch(() => {});

    const timer = window.setTimeout(async () => {
      try {
        const res = await checkForGitHubUpdate();
        if (active) {
          setCurrentVersion(res.currentVersion);
          setUpdateInfo(res);
        }
      } catch {
        // Silent when offline or rate-limited
      }
    }, 2000);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  const handleManualCheck = async () => {
    if (checking || updating) return;
    setChecking(true);
    try {
      const res = await checkForGitHubUpdate();
      setCurrentVersion(res.currentVersion);
      setUpdateInfo(res);
      if (res.hasUpdate) {
        notify(`Nova versão v${res.latestVersion} disponível no GitHub! Clique novamente para atualizar.`);
      } else {
        notify(`LifeHub v${res.currentVersion} já está na última versão do GitHub.`);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao checar GitHub Releases.', 'error');
      setActiveSection('settings');
    } finally {
      setChecking(false);
    }
  };

  if (updateInfo?.hasUpdate) {
    const targetAsset = updateInfo.portableAsset ?? updateInfo.installerAsset;
    const isInstaller = !updateInfo.portableAsset && Boolean(updateInfo.installerAsset);

    const handleUpdateNow = async () => {
      if (!targetAsset || updating) return;
      const ok = window.confirm(
        `Nova versão v${updateInfo.latestVersion} disponível no GitHub (atual: v${updateInfo.currentVersion}).\n\nBaixar e atualizar o LifeHub automaticamente agora? Seus dados locais no SQLite são preservados.`,
      );
      if (!ok) return;
      setUpdating(true);
      try {
        notify(`Baixando LifeHub v${updateInfo.latestVersion} do GitHub...`, 'info');
        await downloadAndInstallUpdate(targetAsset, isInstaller);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Erro ao atualizar automaticamente.', 'error');
        setUpdating(false);
      }
    };

    return (
      <button
        type="button"
        disabled={updating}
        onClick={handleUpdateNow}
        title={`Atualizar da v${updateInfo.currentVersion} para v${updateInfo.latestVersion} direto do GitHub`}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-60"
      >
        {updating ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ArrowDownToLine className="h-3.5 w-3.5" />
        )}
        <span>{updating ? 'Atualizando...' : `Atualizar v${updateInfo.latestVersion}`}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={checking}
      onClick={handleManualCheck}
      title={`LifeHub v${currentVersion} · Clique para checar atualizações no GitHub`}
      aria-label={`Versão v${currentVersion} — verificar atualizações no GitHub`}
      className="lh-control-btn inline-flex shrink-0 items-center gap-1 px-2 py-1.5 font-mono text-[11px] font-semibold opacity-80 transition hover:opacity-100 disabled:opacity-50"
    >
      {checking ? (
        <RefreshCw className="h-3 w-3 animate-spin text-brand-500" />
      ) : (
        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
      )}
      <span>v{currentVersion}</span>
    </button>
  );
};
