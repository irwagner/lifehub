import React, { useEffect, useMemo, useState } from 'react';
import { encode } from 'uqr';
import {
  CheckCircle2,
  Copy,
  KeyRound,
  Lock,
  QrCode,
  ShieldAlert,
  Smartphone,
  Sparkles,
  X,
} from 'lucide-react';
import { buildMobilePairingUrl, normalizeEndpointUrl } from '../services/cloudSync';

export interface QrMatrixSvg {
  size: number;
  path: string;
  moduleCount: number;
}

/**
 * Generates an ISO/IEC 18004 QR Code SVG path 100% locally in memory (zero network requests).
 */
export function buildQrSvgPath(content: string, border = 3): QrMatrixSvg {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('Conteúdo vazio para geração do QR Code.');
  }
  const qr = encode(trimmed, {
    ecc: 'M',
    border,
  });

  const parts: string[] = [];
  let moduleCount = 0;

  for (let y = 0; y < qr.size; y++) {
    const row = qr.data[y];
    let x = 0;
    while (x < qr.size) {
      if (row[x]) {
        const startX = x;
        while (x < qr.size && row[x]) {
          x++;
        }
        const width = x - startX;
        moduleCount += width;
        parts.push(`M${startX} ${y}h${width}v1h-${width}z`);
      } else {
        x++;
      }
    }
  }

  return {
    size: qr.size,
    path: parts.join(''),
    moduleCount,
  };
}

interface PairingQrCodeProps {
  endpointUrl: string;
  passphrase: string;
  geminiApiKey?: string;
  hasSyncedOnce: boolean;
  onGenerateKey: () => void;
  onCopyLink: () => void;
  onClose: () => void;
}

export const PairingQrCode: React.FC<PairingQrCodeProps> = ({
  endpointUrl,
  passphrase,
  geminiApiKey,
  hasSyncedOnce,
  onGenerateKey,
  onCopyLink,
  onClose,
}) => {
  const hasValidKey = passphrase.trim().length >= 8;
  const hasAiKey = Boolean(geminiApiKey?.trim());
  const [mode, setMode] = useState<'pair' | 'app'>(hasValidKey ? 'pair' : 'app');

  useEffect(() => {
    if (hasValidKey) {
      setMode('pair');
    }
  }, [hasValidKey]);

  const activeMode: 'pair' | 'app' = mode === 'pair' && !hasValidKey ? 'app' : mode;

  const qrResult = useMemo(() => {
    try {
      const targetUrl =
        activeMode === 'pair'
          ? buildMobilePairingUrl(endpointUrl, passphrase, { geminiApiKey })
          : normalizeEndpointUrl(endpointUrl);
      const svg = buildQrSvgPath(targetUrl, 3);
      return { ok: true as const, svg, targetUrl };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : 'Não foi possível gerar o QR Code.',
      };
    }
  }, [activeMode, endpointUrl, passphrase, geminiApiKey]);

  return (
    <div className="rounded-2xl border border-brand-500/30 bg-slate-900/[0.03] p-4 dark:bg-white/[0.03]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <QrCode className="h-4 w-4 text-brand-500" />
          <h4 className="text-sm font-semibold">Parear iPhone / Android pela Câmera</h4>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar QR Code"
          className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Mode Selector */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode('pair')}
          disabled={!hasValidKey}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
            activeMode === 'pair'
              ? 'bg-brand-600 text-white shadow-sm'
              : 'border border-slate-300/70 text-slate-600 hover:bg-slate-200/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5'
          }`}
        >
          <Lock className="h-3.5 w-3.5" />
          Pareamento Direto (com Chave)
        </button>
        <button
          type="button"
          onClick={() => setMode('app')}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
            activeMode === 'app'
              ? 'bg-brand-600 text-white shadow-sm'
              : 'border border-slate-300/70 text-slate-600 hover:bg-slate-200/50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5'
          }`}
        >
          <Smartphone className="h-3.5 w-3.5" />
          Apenas Abrir o App (sem Chave)
        </button>
      </div>

      {!hasValidKey && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">
          <span>
            Gere uma <strong>Chave Secreta</strong> acima para ativar o QR de pareamento automático com seus dados.
          </span>
          <button
            type="button"
            onClick={() => {
              onGenerateKey();
              setMode('pair');
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-slate-950 hover:bg-amber-400"
          >
            <KeyRound className="h-3 w-3" /> Gerar Chave Agora
          </button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[216px_1fr] md:items-center">
        {/* Crisp Local SVG QR Box */}
        <div className="flex flex-col items-center">
          {qrResult.ok ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <svg
                role="img"
                aria-label={
                  activeMode === 'pair'
                    ? 'QR Code de pareamento direto do LifeHub'
                    : 'QR Code de acesso ao LifeHub Mobile'
                }
                viewBox={`0 0 ${qrResult.svg.size} ${qrResult.svg.size}`}
                className="h-44 w-44"
                shapeRendering="crispEdges"
              >
                <rect width={qrResult.svg.size} height={qrResult.svg.size} fill="#ffffff" />
                <path d={qrResult.svg.path} fill="#0f172a" />
              </svg>
            </div>
          ) : (
            <div className="flex h-44 w-44 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-center text-xs text-rose-500">
              {qrResult.error}
            </div>
          )}
          <span className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            Gerado 100% offline neste PC
          </span>
          {activeMode === 'pair' && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">
              {hasAiKey ? (
                <>
                  <Sparkles className="h-2.5 w-2.5" /> Chave Sync + Chave IA incluídas
                </>
              ) : (
                <>
                  <Lock className="h-2.5 w-2.5" /> Chave Sync E2EE incluída
                </>
              )}
            </span>
          )}
        </div>

        {/* Step-by-step Instructions for iOS & Android */}
        <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300">
          {!hasSyncedOnce && hasValidKey && (
            <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-700 dark:text-indigo-300">
              <strong>Dica:</strong> clique em <strong>Sincronizar Agora</strong> acima antes de ler o QR Code para enviar seus dados deste PC ao cofre primeiro.
            </div>
          )}

          <ol className="list-decimal space-y-1.5 pl-4">
            <li>
              Abra a <strong>Câmera do iPhone</strong> (ou Android) e aponte para o QR Code ao lado.
            </li>
            <li>
              Toque no link que aparecer para abrir no <strong>Safari (iPhone)</strong> ou{' '}
              <strong>Chrome (Android)</strong>.
              {activeMode === 'pair' && ' A URL e a Chave Secreta serão configuradas automaticamente.'}
            </li>
            <li>
              Para instalar como app no iPhone: toque em <strong>Compartilhar</strong> (quadrado com seta ↑) →{' '}
              <strong>Adicionar à Tela de Início</strong>.
            </li>
          </ol>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onCopyLink}
              disabled={!hasValidKey}
              className="lh-btn-secondary py-1.5 text-xs disabled:opacity-50"
            >
              <Copy className="h-3.5 w-3.5" /> Copiar Link de Pareamento
            </button>
          </div>

          {activeMode === 'pair' && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Este QR inclui sua Chave Secreta no fragmento local (<code>#pair=</code>). Não compartilhe capturas de tela deste código.
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
