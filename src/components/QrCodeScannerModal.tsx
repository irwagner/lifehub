import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, ImageUp, Link2, QrCode, X } from 'lucide-react';
import { parseScannedPairingText } from '../services/cloudSync';

export interface ScannedPairingResult {
  endpointUrl: string;
  passphrase: string;
  geminiApiKey?: string;
}

interface QrCodeScannerModalProps {
  open: boolean;
  onClose: () => void;
  onPaired: (result: ScannedPairingResult) => void | Promise<void>;
}

interface NativeBarcodeDetector {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => NativeBarcodeDetector;
  }
}

export const QrCodeScannerModal: React.FC<QrCodeScannerModalProps> = ({
  open,
  onClose,
  onPaired,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const handledRef = useRef(false);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('Aponte a câmera para o QR Code exibido no LifeHub do PC...');
  const [manualText, setManualText] = useState('');
  const [cameraActive, setCameraActive] = useState(false);

  const stopCamera = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const handleDecodedString = (raw: string): boolean => {
    const parsed = parseScannedPairingText(raw);
    if (!parsed) {
      setStatusMsg('QR Code lido, mas não é um código de pareamento do LifeHub. Tente o QR em "Pareamento Direto (com Chave)".');
      return false;
    }
    if (handledRef.current) return true;
    handledRef.current = true;
    stopCamera();
    void onPaired(parsed);
    return true;
  };

  useEffect(() => {
    if (!open) {
      stopCamera();
      handledRef.current = false;
      setCameraError(null);
      return;
    }

    handledRef.current = false;
    setCameraError(null);
    setStatusMsg('Abrindo câmera...');

    let cancelled = false;

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          'Câmera não disponível neste dispositivo/WebView. Use "Ler de Foto/Print" ou cole o Link de Pareamento abaixo.',
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraActive(true);
        setStatusMsg('Aponte a câmera para o QR Code exibido no LifeHub do PC...');

        let nativeDetector: NativeBarcodeDetector | null = null;
        if (typeof window !== 'undefined' && window.BarcodeDetector) {
          try {
            nativeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
          } catch {
            nativeDetector = null;
          }
        }

        let lastScanAt = 0;
        const scanLoop = async (ts: number) => {
          if (cancelled || handledRef.current) return;
          const video = videoRef.current;
          if (video && video.readyState >= 2 && ts - lastScanAt >= 180) {
            lastScanAt = ts;
            try {
              if (nativeDetector) {
                const found = await nativeDetector.detect(video);
                const val = found.find((b) => b.rawValue)?.rawValue;
                if (val && handleDecodedString(val)) return;
              }
              const canvas = canvasRef.current;
              if (canvas && video.videoWidth > 0 && video.videoHeight > 0) {
                const targetW = Math.min(640, video.videoWidth);
                const scale = targetW / video.videoWidth;
                const targetH = Math.round(video.videoHeight * scale);
                canvas.width = targetW;
                canvas.height = targetH;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                  ctx.drawImage(video, 0, 0, targetW, targetH);
                  const imgData = ctx.getImageData(0, 0, targetW, targetH);
                  const qr = jsQR(imgData.data, targetW, targetH, {
                    inversionAttempts: 'dontInvert',
                  });
                  if (qr?.data && handleDecodedString(qr.data)) return;
                }
              }
            } catch {
              // ignore transient frame read errors
            }
          }
          rafRef.current = requestAnimationFrame((nextTs) => {
            void scanLoop(nextTs);
          });
        };

        rafRef.current = requestAnimationFrame((ts) => {
          void scanLoop(ts);
        });
      } catch (err) {
        if (!cancelled) {
          const msg =
            err instanceof Error
              ? err.message
              : 'Permissão da câmera negada ou câmera indisponível.';
          setCameraError(
            `Não foi possível abrir a câmera (${msg}). Você pode ler um print/foto do QR Code ou colar o link abaixo.`,
          );
        }
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open]);

  if (!open) return null;

  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      const maxDim = 1024;
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas indisponível.');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const qr = jsQR(imgData.data, canvas.width, canvas.height, {
        inversionAttempts: 'attemptBoth',
      });
      if (!qr?.data) {
        setStatusMsg('Nenhum QR Code encontrado nesta imagem. Tente aproximar mais o print.');
        return;
      }
      handleDecodedString(qr.data);
    } catch {
      setStatusMsg('Não foi possível processar esta imagem.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualText.trim()) return;
    if (!handleDecodedString(manualText)) {
      setStatusMsg('Link inválido. Copie o "Link de Pareamento" completo no PC (contendo #pair=).');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lh-modal-panel flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl p-0 shadow-2xl">
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: 'var(--lh-card-border)' }}
        >
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-500/15 text-brand-500">
              <QrCode className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold">Escanear QR Code do PC</h3>
              <p className="text-[11px] opacity-70">Pareamento automático + Sync imediato</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar leitor de QR Code"
            className="lh-control-btn p-1.5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          {/* Live Camera Viewport */}
          <div className="relative overflow-hidden rounded-2xl border border-brand-500/30 bg-slate-950">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`aspect-[4/3] w-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
            />
            {cameraActive && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-44 w-44 rounded-2xl border-2 border-brand-400/90 shadow-[0_0_0_9999px_rgba(2,6,23,0.45)]" />
              </div>
            )}
            {!cameraActive && (
              <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 p-5 text-center text-xs text-slate-300">
                <Camera className="h-8 w-8 text-brand-400 opacity-80" />
                <p>{cameraError ?? 'Iniciando câmera...'}</p>
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          <p className="rounded-xl border border-brand-500/20 bg-brand-500/[0.06] px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
            {statusMsg}
          </p>

          {/* Fallback 1: Decode QR from image/screenshot */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="lh-btn-secondary flex-1 justify-center text-xs"
            >
              <ImageUp className="h-4 w-4" /> Ler QR de Foto / Print
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageFile}
              className="hidden"
            />
          </div>

          {/* Fallback 2: Paste pairing link */}
          <form onSubmit={handleManualSubmit} className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--lh-card-border)' }}>
            <label className="flex items-center gap-1.5 text-[11px] font-semibold opacity-80">
              <Link2 className="h-3.5 w-3.5 text-brand-500" /> Ou cole o Link de Pareamento do PC
            </label>
            <div className="flex gap-2">
              <input
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder="https://lifehub-sync.../#pair=..."
                className="lh-input flex-1 font-mono text-xs"
              />
              <button type="submit" className="lh-btn-primary shrink-0 px-3 text-xs">
                Parear
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
