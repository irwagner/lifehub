import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, Minus, Square, X } from 'lucide-react';
import { useApp, type NavSection } from '../context/AppContext';
import { isTauriRuntime } from '../db/client';
import { getSkinDefinition } from '../services/skins';
import { CURRENT_APP_VERSION } from '../services/updater';
import type { UiSkin } from '../types/domain';

type ChromeStyle = 'macos-dots' | 'retro-3d' | 'poster-bold' | 'cyber-tech' | 'windows-clean';

const SECTION_TITLES: Record<NavSection, string> = {
  dashboard: 'Hoje',
  calendar: 'Calendário',
  finance: 'Financeiro',
  work: 'Trabalho (Uber/99)',
  health: 'Saúde & Hábitos',
  family: 'Família',
  career: 'Estudos & Carreira TI',
  ideas: 'Ideias & Revisão',
  settings: 'Configurações & Skins',
};

function resolveChromeStyle(skinId: UiSkin): ChromeStyle {
  if (skinId === 'retro_classic') return 'retro-3d';
  if (skinId === 'ref_linhas_dia') return 'poster-bold';
  if (
    [
      'concept_voip_desktop',
      'concept_qleandesk',
      'concept_zenite',
      'concept_thebean_ai',
      'concept_student_portal',
      'concept_ramaroo',
    ].includes(skinId)
  ) {
    return 'macos-dots';
  }
  if (
    [
      'concept_cyfocus',
      'concept_gridtrade',
      'concept_iqon_pc',
      'cyber_neon',
      'concept_traffictrace',
    ].includes(skinId)
  ) {
    return 'cyber-tech';
  }
  return 'windows-clean';
}

export const WindowTitleBar: React.FC = () => {
  const { settings, activeSection } = useApp();
  const [isMaximized, setIsMaximized] = useState(false);

  const activeSkin = getSkinDefinition(settings?.ui_skin);
  const chromeStyle = resolveChromeStyle(activeSkin.id);
  const tauri = isTauriRuntime();
  const isNativeMobile = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!tauri || isNativeMobile) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    win.isMaximized().then(setIsMaximized).catch(() => {});
    win
      .onResized(async () => {
        try {
          setIsMaximized(await win.isMaximized());
        } catch {
          // ignore
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      if (unlisten) unlisten();
    };
  }, [tauri]);

  const handleMinimize = async () => {
    if (!tauri) return;
    try {
      await getCurrentWindow().minimize();
    } catch {
      // ignore outside Tauri
    }
  };

  const handleToggleMaximize = async () => {
    if (!tauri) return;
    try {
      const win = getCurrentWindow();
      await win.toggleMaximize();
      setIsMaximized(await win.isMaximized());
    } catch {
      // ignore outside Tauri
    }
  };

  const handleClose = async () => {
    if (!tauri) return;
    try {
      await getCurrentWindow().close();
    } catch {
      // ignore outside Tauri
    }
  };

  const handleStartDrag = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!tauri || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, input, select')) return;
    if (e.detail === 2) {
      await handleToggleMaximize();
      return;
    }
    try {
      await getCurrentWindow().startDragging();
    } catch {
      // fallback to data-tauri-drag-region
    }
  };

  if (isNativeMobile) {
    return null;
  }

  // In browser/mobile preview (outside Tauri desktop), hide Windows window controls on narrow screens
  if (!tauri && typeof window !== 'undefined' && window.innerWidth < 1024) {
    return null;
  }

  const sectionLabel = SECTION_TITLES[activeSection] ?? 'LifeHub';

  // Style 1: macOS / Fluent floating dots integrated on the left, centered title
  if (chromeStyle === 'macos-dots') {
    return (
      <div
        data-tauri-drag-region
        onMouseDown={handleStartDrag}
        className="lh-titlebar flex h-8 shrink-0 select-none items-center justify-between border-b px-3 text-xs"
      >
        <div className="group flex items-center gap-2">
          <button
            type="button"
            onClick={handleClose}
            aria-label="Fechar janela"
            title="Fechar"
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#ff5f57] text-[#5c0b07] ring-1 ring-black/15 transition hover:brightness-105"
          >
            <X className="h-2.5 w-2.5 opacity-0 transition group-hover:opacity-100" strokeWidth={2.8} />
          </button>
          <button
            type="button"
            onClick={handleMinimize}
            aria-label="Minimizar janela"
            title="Minimizar"
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#febc2e] text-[#664100] ring-1 ring-black/15 transition hover:brightness-105"
          >
            <Minus className="h-2.5 w-2.5 opacity-0 transition group-hover:opacity-100" strokeWidth={2.8} />
          </button>
          <button
            type="button"
            onClick={handleToggleMaximize}
            aria-label={isMaximized ? 'Restaurar janela' : 'Maximizar janela'}
            title={isMaximized ? 'Restaurar' : 'Maximizar'}
            className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#28c840] text-[#074d12] ring-1 ring-black/15 transition hover:brightness-105"
          >
            <Square className="h-2 w-2 opacity-0 transition group-hover:opacity-100" strokeWidth={2.8} />
          </button>
        </div>

        <div
          data-tauri-drag-region
          className="flex items-center gap-2 text-[11px] font-semibold tracking-tight opacity-85"
        >
          <span className="h-2 w-2 rounded-full bg-brand-500" />
          <span>LifeHub</span>
          <span className="opacity-40">/</span>
          <span className="font-medium opacity-75">{sectionLabel}</span>
        </div>

        <div className="hidden items-center gap-1.5 text-[10px] font-medium opacity-60 sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span>{activeSkin.name}</span>
        </div>
      </div>
    );
  }

  // Style 2: Retro 98 / Winamp 3D beveled classic window bar
  if (chromeStyle === 'retro-3d') {
    return (
      <div
        data-tauri-drag-region
        onMouseDown={handleStartDrag}
        className="lh-titlebar lh-titlebar-retro flex h-8 shrink-0 select-none items-center justify-between px-2 text-xs font-bold"
      >
        <div data-tauri-drag-region className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 bg-brand-400 shadow-inner" />
          <span className="tracking-tight">
            LifeHub.exe — [{sectionLabel}]
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleMinimize}
            aria-label="Minimizar janela"
            title="Minimizar"
            className="lh-winbtn-retro flex h-5 w-6 items-center justify-center"
          >
            <Minus className="h-3 w-3" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={handleToggleMaximize}
            aria-label={isMaximized ? 'Restaurar janela' : 'Maximizar janela'}
            title={isMaximized ? 'Restaurar' : 'Maximizar'}
            className="lh-winbtn-retro flex h-5 w-6 items-center justify-center"
          >
            {isMaximized ? <Copy className="h-2.5 w-2.5" /> : <Square className="h-2.5 w-2.5" />}
          </button>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Fechar janela"
            title="Fechar"
            className="lh-winbtn-retro lh-winbtn-retro-close flex h-5 w-6 items-center justify-center"
          >
            <X className="h-3 w-3" strokeWidth={2.6} />
          </button>
        </div>
      </div>
    );
  }

  // Style 3: Poster / Metrô bold black borders
  if (chromeStyle === 'poster-bold') {
    return (
      <div
        data-tauri-drag-region
        onMouseDown={handleStartDrag}
        className="lh-titlebar flex h-10 shrink-0 select-none items-center justify-between border-b-2 border-[#141414] px-3.5 text-xs dark:border-[#f2d9a0]"
      >
        <div data-tauri-drag-region className="flex items-center gap-2">
          <span className="rounded-full border-2 border-current bg-brand-500 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
            LIFEHUB
          </span>
          <span className="font-black uppercase tracking-tight">{sectionLabel}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleMinimize}
            aria-label="Minimizar janela"
            title="Minimizar"
            className="flex h-6 w-7 items-center justify-center rounded-full border-2 border-[#141414] bg-transparent transition hover:bg-black/10 dark:border-[#f2d9a0] dark:hover:bg-white/10"
          >
            <Minus className="h-3 w-3" strokeWidth={2.6} />
          </button>
          <button
            type="button"
            onClick={handleToggleMaximize}
            aria-label={isMaximized ? 'Restaurar janela' : 'Maximizar janela'}
            title={isMaximized ? 'Restaurar' : 'Maximizar'}
            className="flex h-6 w-7 items-center justify-center rounded-full border-2 border-[#141414] bg-transparent transition hover:bg-black/10 dark:border-[#f2d9a0] dark:hover:bg-white/10"
          >
            {isMaximized ? (
              <Copy className="h-2.5 w-2.5" strokeWidth={2.5} />
            ) : (
              <Square className="h-2.5 w-2.5" strokeWidth={2.5} />
            )}
          </button>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Fechar janela"
            title="Fechar"
            className="flex h-6 w-7 items-center justify-center rounded-full border-2 border-[#141414] bg-brand-500 text-white transition hover:brightness-110 dark:border-[#f2d9a0]"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.8} />
          </button>
        </div>
      </div>
    );
  }

  // Style 4: Cyber / SOC / Telemetry Console header strip
  if (chromeStyle === 'cyber-tech') {
    return (
      <div
        data-tauri-drag-region
        onMouseDown={handleStartDrag}
        className="lh-titlebar flex h-8 shrink-0 select-none items-center justify-between border-b pl-3 text-xs"
      >
        <div data-tauri-drag-region className="flex items-center gap-2.5 font-mono text-[11px]">
          <span className="inline-block h-2 w-2 rounded-sm bg-brand-500 shadow-[0_0_8px_rgb(var(--lh-brand-500))]" />
          <span className="font-bold tracking-wider">LIFEHUB // {sectionLabel.toUpperCase()}</span>
          <span className="hidden rounded border border-brand-500/35 bg-brand-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-brand-400 sm:inline">
            {activeSkin.name}
          </span>
        </div>

        <div className="flex h-full items-stretch">
          <button
            type="button"
            onClick={handleMinimize}
            aria-label="Minimizar janela"
            title="Minimizar"
            className="lh-winbtn flex w-10 items-center justify-center"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleToggleMaximize}
            aria-label={isMaximized ? 'Restaurar janela' : 'Maximizar janela'}
            title={isMaximized ? 'Restaurar' : 'Maximizar'}
            className="lh-winbtn flex w-10 items-center justify-center"
          >
            {isMaximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Fechar janela"
            title="Fechar"
            className="lh-winbtn lh-winbtn-close flex w-11 items-center justify-center"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // Style 5: Modern Windows 11 clean integrated chrome (default for Editorial, Clean, Orbital, SaaS, Dual-Tone)
  return (
    <div
      data-tauri-drag-region
      onMouseDown={handleStartDrag}
      className="lh-titlebar flex h-9 shrink-0 select-none items-center justify-between border-b pl-3.5 text-xs"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 text-[11px] font-semibold">
        <span className="flex h-4 w-4 items-center justify-center rounded bg-brand-500 text-[9px] font-bold text-[color:var(--lh-btn-primary-fg,#ffffff)]">
          L
        </span>
        <span className="opacity-90">LifeHub</span>
        <span className="rounded bg-brand-500/15 px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-brand-500">
          v{CURRENT_APP_VERSION}
        </span>
        <span className="opacity-35">·</span>
        <span className="font-medium opacity-70">{sectionLabel}</span>
        <span className="hidden opacity-30 sm:inline">·</span>
        <span className="hidden text-[10px] font-medium opacity-55 sm:inline">{activeSkin.name}</span>
      </div>

      <div className="flex h-full items-stretch">
        <button
          type="button"
          onClick={handleMinimize}
          aria-label="Minimizar janela"
          title="Minimizar"
          className="lh-winbtn flex w-11 items-center justify-center"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleToggleMaximize}
          aria-label={isMaximized ? 'Restaurar janela' : 'Maximizar janela'}
          title={isMaximized ? 'Restaurar' : 'Maximizar'}
          className="lh-winbtn flex w-11 items-center justify-center"
        >
          {isMaximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Fechar janela"
          title="Fechar"
          className="lh-winbtn lh-winbtn-close flex w-12 items-center justify-center"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
