import React, { useEffect, useRef, useState } from 'react';
import { Check, Moon, Palette, Sun } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { CLASSIC_SKINS, REFERENCE_SKINS, UI_SKINS, type SkinDefinition } from '../services/skins';
import type { UiSkin } from '../types/domain';

export const SkinSwitcher: React.FC = () => {
  const { settings, patchSettings, notify } = useApp();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const currentSkinId: UiSkin = settings?.ui_skin ?? 'orbital';
  const currentSkin = UI_SKINS.find((s) => s.id === currentSkinId) ?? UI_SKINS[0];

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onOutside);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onOutside);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSelectSkin = async (skin: SkinDefinition) => {
    await patchSettings({ ui_skin: skin.id, theme: skin.preferredTheme });
    notify(`Skin "${skin.name}" aplicada.`);
  };

  const renderSkinRow = (skin: SkinDefinition) => {
    const active = skin.id === currentSkinId;
    return (
      <button
        key={skin.id}
        type="button"
        onClick={() => handleSelectSkin(skin)}
        className={`flex w-full items-start gap-2.5 rounded-xl border p-2 text-left transition ${
          active
            ? 'border-brand-500 bg-brand-500/10'
            : 'border-slate-200/70 hover:border-brand-400/50 hover:bg-slate-50 dark:border-white/[0.06] dark:hover:bg-white/[0.04]'
        }`}
      >
        <div className="mt-0.5 flex shrink-0 overflow-hidden rounded-lg border border-black/15 shadow-sm">
          <span className="h-7 w-2.5" style={{ backgroundColor: skin.swatches[0] }} />
          <span className="h-7 w-2.5" style={{ backgroundColor: skin.swatches[1] }} />
          <span className="h-7 w-3" style={{ backgroundColor: skin.swatches[2] }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <span className="truncate text-xs font-semibold text-slate-900 dark:text-white">
              {skin.name}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-white/[0.07] dark:text-slate-300">
              {skin.preferredTheme === 'dark' ? (
                <Moon className="h-2.5 w-2.5" />
              ) : (
                <Sun className="h-2.5 w-2.5" />
              )}
              {skin.vibe}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
            {skin.tagline}
          </p>
        </div>
        {active && <Check className="mt-1 h-4 w-4 shrink-0 text-brand-500" />}
      </button>
    );
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`Skin ativa: ${currentSkin.name}`}
        aria-label="Trocar skin de design"
        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-brand-400/60 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
      >
        <Palette className="h-3.5 w-3.5 text-brand-500" />
        <span className="hidden sm:inline">Skins</span>
        <span
          className="h-2 w-2 rounded-full ring-1 ring-black/20"
          style={{ backgroundColor: currentSkin.swatches[2] }}
        />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 max-h-[76vh] w-[22rem] overflow-y-auto rounded-2xl border border-slate-200/90 bg-white p-3 shadow-2xl animate-scale-in dark:border-white/[0.1] dark:bg-[#0f172a]">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-xs font-bold text-slate-900 dark:text-white">
              Skins de Design ({UI_SKINS.length})
            </p>
            <span className="text-[10px] text-slate-500">Troca ao vivo</span>
          </div>

          <p className="mb-1.5 mt-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">
            Referências de Design ({REFERENCE_SKINS.length})
          </p>
          <div className="space-y-1.5">{REFERENCE_SKINS.map(renderSkinRow)}</div>

          <p className="mb-1.5 mt-3.5 border-t border-slate-200/70 pt-2.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:border-white/[0.07]">
            Skins Anteriores Preservadas ({CLASSIC_SKINS.length})
          </p>
          <div className="space-y-1.5">{CLASSIC_SKINS.map(renderSkinRow)}</div>
        </div>
      )}
    </div>
  );
};
