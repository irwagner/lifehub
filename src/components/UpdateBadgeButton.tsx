import React, { useEffect, useState } from 'react';
import { ArrowDownToLine, RefreshCw } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  checkForGitHubUpdate,
  downloadAndInstallUpdate,
  type UpdateCheckResult,
} from '../services/updater';

export const UpdateBadgeButton: React.FC = () => {
  const { notify } = useApp();
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const res = await checkForGitHubUpdate();
        if (active && res.hasUpdate) {
          setUpdateInfo(res);
        }
      } catch {
        // Silent when offline or rate-limited
      }
    }, 2500);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  if (!updateInfo?.hasUpdate) return null;

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
      title={`Atualizar para v${updateInfo.latestVersion} direto do GitHub`}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-60"
    >
      {updating ? (
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <ArrowDownToLine className="h-3.5 w-3.5" />
      )}
      <span>{updating ? 'Atualizando...' : `v${updateInfo.latestVersion}`}</span>
    </button>
  );
};
