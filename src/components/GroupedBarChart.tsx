import React, { useId } from 'react';
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
 * Pure, accessible, zero-dependency SVG grouped bar chart with subtle gridlines and gradients.
 */
export const GroupedBarChart: React.FC<GroupedBarChartProps> = ({
  items,
  primaryLabel,
  secondaryLabel,
  primaryColorClass = 'fill-emerald-500',
  secondaryColorClass = 'fill-rose-500',
}) => {
  const uid = useId().replace(/:/g, '');
  if (items.length === 0) return null;

  const maxVal = Math.max(
    1,
    ...items.flatMap((i) => [Math.max(0, i.primaryValue), Math.max(0, i.secondaryValue)]),
  );

  const leftPad = 56;
  const chartHeight = 148;
  const topPad = 14;
  const groupWidth = 86;
  const svgWidth = Math.max(380, leftPad + items.length * groupWidth + 18);

  const gridTicks = [0, 0.5, 1];

  const primaryHex = primaryColorClass.includes('indigo') ? '#6366f1' : '#10b981';
  const primaryHexBottom = primaryColorClass.includes('indigo') ? '#4338ca' : '#059669';
  const secondaryHex = secondaryColorClass.includes('emerald') ? '#10b981' : '#f43f5e';
  const secondaryHexBottom = secondaryColorClass.includes('emerald') ? '#047857' : '#be123c';

  return (
    <div className="space-y-3 rounded-xl border border-slate-200/70 bg-slate-50/50 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
      <div className="flex flex-wrap items-center gap-4 text-[11px] font-medium text-slate-600 dark:text-slate-300">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: primaryHex }}
          />
          {primaryLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: secondaryHex }}
          />
          {secondaryLabel}
        </span>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgWidth} ${chartHeight + topPad + 26}`}
          className="h-48 w-full min-w-[360px]"
          role="img"
          aria-label={`${primaryLabel} vs ${secondaryLabel}`}
        >
          <defs>
            <linearGradient id={`p_${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primaryHex} stopOpacity="0.95" />
              <stop offset="100%" stopColor={primaryHexBottom} stopOpacity="0.65" />
            </linearGradient>
            <linearGradient id={`s_${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={secondaryHex} stopOpacity="0.92" />
              <stop offset="100%" stopColor={secondaryHexBottom} stopOpacity="0.6" />
            </linearGradient>
          </defs>

          {/* Horizontal reference gridlines */}
          {gridTicks.map((ratio) => {
            const y = topPad + chartHeight * (1 - ratio);
            const val = maxVal * ratio;
            return (
              <g key={ratio}>
                <line
                  x1={leftPad}
                  y1={y}
                  x2={svgWidth - 10}
                  y2={y}
                  strokeDasharray={ratio === 0 ? undefined : '3 4'}
                  className="stroke-slate-300/80 dark:stroke-white/[0.08]"
                  strokeWidth="1"
                />
                <text
                  x={leftPad - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-slate-400 text-[9px] tabular-nums dark:fill-slate-500"
                >
                  {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : Math.round(val)}
                </text>
              </g>
            );
          })}

          {items.map((item, idx) => {
            const xBase = leftPad + 14 + idx * groupWidth;
            const h1 = Math.max(3, (Math.max(0, item.primaryValue) / maxVal) * chartHeight);
            const h2 = Math.max(3, (Math.max(0, item.secondaryValue) / maxVal) * chartHeight);
            return (
              <g key={`${item.label}_${idx}`}>
                <rect
                  x={xBase}
                  y={topPad + chartHeight - h1}
                  width="24"
                  height={h1}
                  rx="6"
                  fill={`url(#p_${uid})`}
                  className="transition-opacity hover:opacity-100"
                >
                  <title>{`${item.label} — ${primaryLabel}: ${formatBRL(item.primaryValue)}`}</title>
                </rect>
                <rect
                  x={xBase + 29}
                  y={topPad + chartHeight - h2}
                  width="24"
                  height={h2}
                  rx="6"
                  fill={`url(#s_${uid})`}
                  className="transition-opacity hover:opacity-100"
                >
                  <title>{`${item.label} — ${secondaryLabel}: ${formatBRL(item.secondaryValue)}`}</title>
                </rect>
                <text
                  x={xBase + 26.5}
                  y={topPad + chartHeight + 17}
                  textAnchor="middle"
                  className="fill-slate-500 text-[10px] font-medium dark:fill-slate-400"
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
