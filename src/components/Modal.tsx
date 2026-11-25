import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidthClass?: string;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  title,
  subtitle,
  onClose,
  children,
  maxWidthClass = 'max-w-lg',
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`lh-modal-panel w-full ${maxWidthClass} max-h-[88vh] overflow-y-auto p-6 animate-scale-in`}
      >
        <div
          className="mb-5 flex items-start justify-between gap-4 border-b pb-4"
          style={{ borderColor: 'var(--lh-card-border)' }}
        >
          <div>
            <h2 className="text-lg font-bold tracking-tight">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="lh-control-btn flex h-8 w-8 shrink-0 items-center justify-center opacity-75 hover:opacity-100"
            aria-label="Fechar janela"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};
