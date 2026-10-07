/**
 * Dashboard charts drawn as plain SVG/HTML.
 * Conventions: thin bars (<= 24px) with a rounded data end, hairline grid, one y-axis,
 * a legend for two series, values in text ink (never in the series colour), and a
 * hover tooltip on every mark. Series colours were checked for colour-blind separation.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { compactPeso, peso } from '../lib/format';
import { cn } from './ui';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Rounds up to a clean axis maximum: 1, 2, 2.5, 5 x 10^n. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (value <= step * magnitude) return step * magnitude;
  return 10 * magnitude;
}

const topRounded = (x: number, y: number, w: number, h: number, r: number) => {
  const radius = Math.min(r, h, w / 2);
  return `M${x},${y + h} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + w - radius} Q${x + w},${y} ${x + w},${y + radius} V${y + h} Z`;
};

export interface GroupedDatum {
  label: string;
  a: number;
  b: number;
}

/** Two measures on one shared axis, compared month by month. */
export function GroupedColumns({ data, seriesA, seriesB, height = 210 }: { data: GroupedDatum[]; seriesA: string; seriesB: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const margin = { top: 8, right: 8, bottom: 22, left: 52 };
  const plotW = Math.max(width - margin.left - margin.right, 0);
  const plotH = height - margin.top - margin.bottom;
  const max = niceMax(Math.max(...data.flatMap((d) => [d.a, d.b]), 1));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const band = data.length ? plotW / data.length : 0;
  const bar = Math.min(24, Math.max((band - 14) / 2, 4));
  const y = (v: number) => margin.top + plotH - (v / max) * plotH;

  return (
    <div>
      <div className="mb-1 flex items-center gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-series-1" /> {seriesA}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-series-2" /> {seriesB}
        </span>
      </div>
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={`${seriesA} versus ${seriesB} by month`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={margin.left} x2={width - margin.right} y1={y(t)} y2={y(t)} stroke="#E2E8F0" strokeWidth={1} />
                <text x={margin.left - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-500 text-[10px] tabular-nums">
                  {compactPeso(t).replace('.00', '')}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const center = margin.left + band * i + band / 2;
              return (
                <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={margin.left + band * i} y={margin.top} width={band} height={plotH} fill={hover === i ? '#F1F5F9' : 'transparent'} />
                  <path d={topRounded(center - bar - 1, y(d.a), bar, margin.top + plotH - y(d.a), 4)} className="fill-series-1" />
                  <path d={topRounded(center + 1, y(d.b), bar, margin.top + plotH - y(d.b), 4)} className="fill-series-2" />
                  <text x={center} y={height - 6} textAnchor="middle" className="fill-slate-600 text-[10px]">
                    {d.label}
                  </text>
                </g>
              );
            })}
            <line x1={margin.left} x2={width - margin.right} y1={margin.top + plotH} y2={margin.top + plotH} stroke="#CBD5E1" strokeWidth={1} />
          </svg>
        )}
        {hover !== null && data[hover] && (
          <div
            className="pointer-events-none absolute top-1 z-10 w-44 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: Math.min(Math.max(margin.left + band * hover + band / 2 - 88, 0), Math.max(width - 176, 0)) }}
          >
            <p className="mb-1 font-medium text-ink">{data[hover].label}</p>
            <TooltipRow swatch="bg-series-1" label={seriesA} value={peso(data[hover].a)} />
            <TooltipRow swatch="bg-series-2" label={seriesB} value={peso(data[hover].b)} />
            <p className="mt-1 border-t border-line pt-1 text-muted">
              Collection rate {data[hover].a > 0 ? `${((data[hover].b / data[hover].a) * 100).toFixed(1)}%` : '—'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function TooltipRow({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <p className="flex items-center justify-between gap-3">
      <span className="inline-flex items-center gap-1.5 text-slate-600">
        <span className={cn('size-2 rounded-sm', swatch)} /> {label}
      </span>
      <span className="num font-medium text-ink">{value}</span>
    </p>
  );
}

export interface BarListItem {
  label: string;
  value: number;
  note?: ReactNode;
  /** Tailwind background class; defaults to the primary series colour. */
  color?: string;
}

/** Labelled horizontal bars: every bar carries its name and value as text, so it doubles as its own table. */
export function BarList({ items, format = peso, emptyText = 'No data for this period.' }: { items: BarListItem[]; format?: (value: number) => string; emptyText?: string }) {
  const max = Math.max(...items.map((i) => i.value), 0);
  const total = items.reduce((sum, i) => sum + i.value, 0);
  if (!items.length || max <= 0) return <p className="py-6 text-center text-sm text-muted">{emptyText}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label} title={`${item.label}: ${format(item.value)} (${total ? ((item.value / total) * 100).toFixed(1) : '0.0'}% of total)`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-slate-700">
              {item.label}
              {item.note && <span className="ml-1.5 text-muted">{item.note}</span>}
            </span>
            <span className="num font-medium text-ink">{format(item.value)}</span>
          </div>
          <div className="h-2.5 rounded-r bg-slate-100">
            <div className={cn('h-2.5 rounded-r', item.color ?? 'bg-series-1')} style={{ width: `${Math.max((item.value / max) * 100, item.value > 0 ? 1 : 0)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
