import React from 'react';

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
  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center dark:border-slate-800 dark:bg-slate-900/40">
    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{title}</p>
    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="mt-3 inline-flex items-center rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700"
      >
        {actionLabel}
      </button>
    )}
  </div>
);
