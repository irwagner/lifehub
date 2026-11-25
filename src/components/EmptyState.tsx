import React from 'react';
import { Sparkles } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionLabel,
  onAction,
}) => (
  <div
    className="flex flex-col items-center justify-center border border-dashed px-6 py-8 text-center"
    style={{
      borderColor: 'var(--lh-card-border)',
      borderRadius: 'var(--lh-radius-card)',
      backgroundColor: 'var(--lh-canvas)',
    }}
  >
    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500 dark:text-brand-400">
      <Sparkles className="h-5 w-5" />
    </div>
    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</p>
    <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">
      {description}
    </p>
    {actionLabel && onAction && (
      <button type="button" onClick={onAction} className="lh-btn-primary mt-4">
        {actionLabel}
      </button>
    )}
  </div>
);
