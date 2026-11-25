import React from 'react';
import { formatBRL } from '../utils/format';

export interface GroupedBarItem {
  label: string;
  primaryValue: number;
  secondaryValue: number;
}

interface GroupedBarChartProps {
  items: GroupedBarItem[];
  primaryLabel: string;
  secondaryLabel: string;
  primaryColorClass?: string;
  secondaryColorClass?: string;
}

/**
 * Pure, accessible, zero-dependency SVG grouped bar chart for dark/light mode.
 */
export const GroupedBarChart: React.FC<GroupedBarChartProps> = ({
  items,
  primaryLabel,
  secondaryLabel,
  primaryColorClass = 'fill-emerald-500',
  secondaryColorClass = 'fill-rose-500',
}) => {
  if (items.length === 0) return null;

  const maxVal = Math.max(
    1,
    ...items.flatMap((i) => [Math.max(0, i.primaryValue), Math.max(0, i.secondaryValue)]),
  );

  const chartHeight = 136;
  const groupWidth = 84;
  const svgWidth = Math.max(320, items.length * groupWidth + 24);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${primaryColorClass.replace('fill-', 'bg-')}`} />
          {primaryLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`h-2.5 w-2.5 rounded-sm ${secondaryColorClass.replace('fill-', 'bg-')}`}
          />
          {secondaryLabel}
        </span>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgWidth} ${chartHeight + 28}`}
          className="h-44 w-full min-w-[320px]"
          role="img"
          aria-label={`${primaryLabel} vs ${secondaryLabel}`}
        >
          {/* Baseline */}
          <line
            x1="8"
            y1={chartHeight}
            x2={svgWidth - 8}
            y2={chartHeight}
            className="stroke-slate-300 dark:stroke-slate-700"
            strokeWidth="1"
          />

          {items.map((item, idx) => {
            const xBase = 16 + idx * groupWidth;
            const h1 = Math.max(2, (Math.max(0, item.primaryValue) / maxVal) * (chartHeight - 16));
            const h2 = Math.max(
              2,
              (Math.max(0, item.secondaryValue) / maxVal) * (chartHeight - 16),
            );
            return (
              <g key={`${item.label}_${idx}`}>
                <rect
                  x={xBase}
                  y={chartHeight - h1}
                  width="24"
                  height={h1}
                  rx="4"
                  className={`${primaryColorClass} opacity-90 transition-opacity hover:opacity-100`}
                >
                  <title>{`${item.label} — ${primaryLabel}: ${formatBRL(item.primaryValue)}`}</title>
                </rect>
                <rect
                  x={xBase + 28}
                  y={chartHeight - h2}
                  width="24"
                  height={h2}
                  rx="4"
                  className={`${secondaryColorClass} opacity-85 transition-opacity hover:opacity-100`}
                >
                  <title>{`${item.label} — ${secondaryLabel}: ${formatBRL(item.secondaryValue)}`}</title>
                </rect>
                <text
                  x={xBase + 26}
                  y={chartHeight + 16}
                  textAnchor="middle"
                  className="fill-slate-500 text-[10px] dark:fill-slate-400"
                >
                  {item.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
