import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { colorForLabel, CHART_COLORS } from '../constants/chartTheme';

export interface CountRow {
  label: string;
  count: number;
}

type HoverPoint = {
  name: string;
  value: number | string;
  color: string;
  x: number;
  y: number;
};

function useChartInk() {
  if (typeof window === 'undefined') {
    return { tick: '#64748b', grid: '#e2e8f0' };
  }
  const styles = getComputedStyle(document.documentElement);
  return {
    tick: styles.getPropertyValue('--wb-chart-tick').trim() || '#64748b',
    grid: styles.getPropertyValue('--wb-chart-grid').trim() || '#e2e8f0',
  };
}

function ChartHoverCard({
  title,
  value,
  color,
  meta = 'Use cases',
}: {
  title: string;
  value: number | string;
  color?: string;
  meta?: string;
}) {
  return (
    <div className="wb-chart-hover">
      <p className="wb-chart-hover-title">{title}</p>
      <div className="wb-chart-hover-row">
        {color ? <span className="wb-chart-hover-swatch" style={{ backgroundColor: color }} /> : null}
        <span className="wb-chart-hover-meta">{meta}</span>
        <span className="wb-chart-hover-value">{value}</span>
      </div>
    </div>
  );
}

function hoverCardOffset(x: number, y: number, width: number, height: number): CSSProperties {
  const pad = 8;
  const estimatedW = 196;
  const estimatedH = 64;
  let left = x + 14;
  let top = y - estimatedH - 10;
  if (left + estimatedW > width - pad) left = x - estimatedW - 12;
  if (left < pad) left = pad;
  if (top < pad) top = y + 14;
  if (top + estimatedH > height - pad) top = Math.max(pad, height - estimatedH - pad);
  return { left, top };
}

function useSmoothHover() {
  const [hover, setHover] = useState<HoverPoint | null>(null);
  const [visible, setVisible] = useState(false);
  const lastHover = useRef<HoverPoint | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFrame = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (showFrame.current) cancelAnimationFrame(showFrame.current);
    },
    [],
  );

  const show = (next: HoverPoint) => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    lastHover.current = next;
    setHover((prev) => {
      if (prev && prev.name === next.name && prev.value === next.value) return prev;
      return next;
    });
    if (showFrame.current) cancelAnimationFrame(showFrame.current);
    showFrame.current = requestAnimationFrame(() => {
      showFrame.current = requestAnimationFrame(() => setVisible(true));
    });
  };

  const hide = () => {
    if (showFrame.current) {
      cancelAnimationFrame(showFrame.current);
      showFrame.current = null;
    }
    setVisible(false);
    hideTimer.current = setTimeout(() => setHover(null), 420);
  };

  return { hover: hover || lastHover.current, visible, show, hide };
}

function ChartHoverLayer({
  hover,
  visible,
  width,
  height,
}: {
  hover: HoverPoint | null;
  visible: boolean;
  width: number;
  height: number;
}) {
  const lastHover = useRef<HoverPoint | null>(hover);
  if (hover) lastHover.current = hover;
  const point = hover || lastHover.current;
  if (!point) return null;

  return (
    <div
      className={`wb-chart-hover-layer${visible ? ' is-visible' : ''}`}
      style={hoverCardOffset(point.x, point.y, width, height)}
      aria-hidden
    >
      <ChartHoverCard title={point.name} value={point.value} color={point.color} />
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`wb-card-pad wb-chart-surface flex flex-col min-h-[360px] overflow-visible ${className}`}>
      <div className="mb-4">
        <h3 className="font-display text-sm font-semibold text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-ink-subtle mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex-1 min-h-[268px] w-full overflow-visible">{children}</div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-full min-h-[220px] flex items-center justify-center text-sm text-ink-subtle italic">
      No data available
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="wb-stat wb-chart-surface">
      <p className="wb-stat-label">{label}</p>
      <p className="wb-stat-value">{value}</p>
      {hint && <p className="text-xs text-ink-subtle mt-1">{hint}</p>}
    </div>
  );
}

export function HorizontalBarChartCard({
  title,
  subtitle,
  rows,
  maxBars = 12,
}: {
  title: string;
  subtitle?: string;
  rows: CountRow[];
  maxBars?: number;
}) {
  const theme = useChartInk();
  const wrapRef = useRef<HTMLDivElement>(null);
  const { hover, visible, show, hide } = useSmoothHover();
  const data = [...rows]
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, maxBars)
    .map((r, i) => ({
      name: r.label.length > 28 ? `${r.label.slice(0, 26)}…` : r.label,
      fullName: r.label,
      value: r.count,
      fill: colorForLabel(r.label, i),
    }));

  return (
    <ChartCard title={title} subtitle={subtitle}>
      {data.length === 0 ? (
        <EmptyChart />
      ) : (
        <div
          ref={wrapRef}
          className="relative h-full w-full overflow-visible"
          onMouseLeave={hide}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 8, right: 28, left: 8, bottom: 4 }}
              onMouseMove={(state) => {
                if (!state.isTooltipActive || state.activeIndex == null || !state.activeCoordinate) {
                  return;
                }
                const item = data[Number(state.activeIndex)];
                if (!item) return;
                show({
                  name: item.fullName,
                  value: item.value,
                  color: item.fill,
                  x: state.activeCoordinate.x,
                  y: state.activeCoordinate.y,
                });
              }}
              onMouseLeave={hide}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fill: theme.tick, fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fill: theme.tick, fontSize: 11 }}
              />
              <Tooltip cursor={{ fill: 'rgba(19,199,232,0.08)' }} content={() => null} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16}>
                {data.map((entry) => (
                  <Cell key={entry.fullName} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <ChartHoverLayer
            hover={hover}
            visible={visible}
            width={wrapRef.current?.clientWidth || 280}
            height={wrapRef.current?.clientHeight || 240}
          />
        </div>
      )}
    </ChartCard>
  );
}

export function VerticalBarChartCard({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle?: string;
  rows: CountRow[];
}) {
  const theme = useChartInk();
  const wrapRef = useRef<HTMLDivElement>(null);
  const { hover, visible, show, hide } = useSmoothHover();
  const data = rows.map((r, i) => ({
    name: r.label,
    value: r.count,
    fill: colorForLabel(r.label, i),
  }));
  const hasData = data.some((d) => d.value > 0);
  const yMax = Math.max(...data.map((d) => d.value), 0);

  return (
    <ChartCard title={title} subtitle={subtitle}>
      {!hasData ? (
        <EmptyChart />
      ) : (
        <div
          ref={wrapRef}
          className="relative h-full w-full overflow-visible"
          onMouseLeave={hide}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 28, right: 12, left: 0, bottom: 48 }}
              onMouseMove={(state) => {
                if (!state.isTooltipActive || state.activeIndex == null || !state.activeCoordinate) {
                  return;
                }
                const item = data[Number(state.activeIndex)];
                if (!item) return;
                show({
                  name: item.name,
                  value: item.value,
                  color: item.fill,
                  x: state.activeCoordinate.x,
                  y: state.activeCoordinate.y,
                });
              }}
              onMouseLeave={hide}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
              <XAxis
                dataKey="name"
                interval={0}
                angle={-28}
                textAnchor="end"
                height={60}
                tick={{ fill: theme.tick, fontSize: 10 }}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: theme.tick, fontSize: 11 }}
                domain={[0, Math.max(yMax + 1, Math.ceil(yMax * 1.2))]}
              />
              <Tooltip cursor={{ fill: 'rgba(19,199,232,0.08)' }} content={() => null} />
              <Bar dataKey="value" name="Use cases" radius={[6, 6, 0, 0]} barSize={28}>
                {data.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
                <LabelList
                  dataKey="value"
                  position="top"
                  offset={8}
                  style={{ fill: theme.tick, fontSize: 11, fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <ChartHoverLayer
            hover={hover}
            visible={visible}
            width={wrapRef.current?.clientWidth || 280}
            height={wrapRef.current?.clientHeight || 240}
          />
        </div>
      )}
    </ChartCard>
  );
}

export function DonutChartCard({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle?: string;
  rows: CountRow[];
}) {
  const theme = useChartInk();
  const wrapRef = useRef<HTMLDivElement>(null);
  const { hover, visible, show, hide } = useSmoothHover();
  const data = rows
    .filter((r) => r.count > 0)
    .map((r, i) => ({
      name: r.label,
      value: r.count,
      fill: colorForLabel(r.label, i),
    }));
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <ChartCard title={title} subtitle={subtitle}>
      {data.length === 0 ? (
        <EmptyChart />
      ) : (
        <div
          ref={wrapRef}
          className="relative h-full w-full overflow-visible"
          onMouseLeave={hide}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="46%"
                innerRadius="58%"
                outerRadius="78%"
                paddingAngle={2}
                stroke="none"
                onMouseMove={(entry, _index, event) => {
                  const rect = wrapRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  show({
                    name: String(entry.name ?? entry.payload?.name ?? ''),
                    value: Number(entry.value ?? entry.payload?.value ?? 0),
                    color: String(entry.fill || entry.payload?.fill || CHART_COLORS[0]),
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top,
                  });
                }}
                onMouseLeave={hide}
              >
                {data.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill || CHART_COLORS[0]} />
                ))}
              </Pie>
              <Legend
                verticalAlign="bottom"
                height={48}
                wrapperStyle={{ fontSize: 11, color: theme.tick }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-x-0 top-[38%] z-0 flex flex-col items-center">
            <span className="text-[11px] uppercase tracking-wide text-ink-subtle">Total</span>
            <span className="font-display text-2xl font-semibold text-ink tabular-nums">{total}</span>
          </div>
          <ChartHoverLayer
            hover={hover}
            visible={visible}
            width={wrapRef.current?.clientWidth || 280}
            height={wrapRef.current?.clientHeight || 240}
          />
        </div>
      )}
    </ChartCard>
  );
}
