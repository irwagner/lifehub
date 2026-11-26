import React, { useEffect, useState } from 'react';
import { ArrowDownToLine, RefreshCw, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  checkForGitHubUpdate,
  downloadAndInstallUpdate,
  selectPlatformUpdateAsset,
  type UpdateCheckResult,
} from '../services/updater';

export const UpdateBanner: React.FC = () => {
  const { notify } = useApp();
  const [info, setInfo] = useState<UpdateCheckResult | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const res = await checkForGitHubUpdate();
        if (active && res.hasUpdate) {
          setInfo(res);
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

  if (!info || !info.hasUpdate || dismissed) return null;

  const { asset, isInstaller, platform } = selectPlatformUpdateAsset(info);

  const handleUpdate = async () => {
    if (updating) return;
    if (!asset) {
      window.open(info.releaseUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    setUpdating(true);
    setProgress(platform === 'android' ? 0 : null);
    try {
      const msg = await downloadAndInstallUpdate(asset, isInstaller, (pct) => {
        setProgress(pct);
      });
      notify(msg, 'info');
      setUpdating(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erro ao baixar atualização.', 'error');
      setUpdating(false);
      setProgress(null);
    }
  };

  return (
    <div className="fixed inset-x-3 bottom-[76px] z-50 mx-auto max-w-md animate-scale-in lg:bottom-5 lg:left-5 lg:right-auto lg:mx-0">
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/40 bg-slate-900/95 px-3.5 py-2.5 text-white shadow-2xl backdrop-blur-xl">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
          {updating ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowDownToLine className="h-4 w-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-emerald-300">
            Nova versão v{info.latestVersion} disponível!
          </p>
          <p className="truncate text-[11px] text-slate-300">
            {updating
              ? progress !== null
                ? `Baixando atualização (${progress}%)...`
                : 'Baixando e preparando instalação...'
              : 'Atualize direto aqui sem abrir o GitHub (dados mantidos).'}
          </p>
        </div>

        <button
          type="button"
          disabled={updating}
          onClick={handleUpdate}
          className="shrink-0 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-400 active:scale-95 disabled:opacity-60"
        >
          {updating ? (progress !== null ? `${progress}%` : '...') : 'Atualizar'}
        </button>

        {!updating && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Fechar aviso de atualização"
            className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
};
