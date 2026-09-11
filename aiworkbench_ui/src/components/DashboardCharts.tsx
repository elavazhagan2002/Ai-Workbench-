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

function useChartInk() {
  if (typeof window === 'undefined') {
    return { tick: '#64748b', grid: '#e2e8f0', tooltipBg: '#fff', tooltipBorder: '#d8e0ec' };
  }
  const styles = getComputedStyle(document.documentElement);
  return {
    tick: styles.getPropertyValue('--wb-chart-tick').trim() || '#64748b',
    grid: styles.getPropertyValue('--wb-chart-grid').trim() || '#e2e8f0',
    tooltipBg: styles.getPropertyValue('--wb-surface-elevated').trim() || '#fff',
    tooltipBorder: styles.getPropertyValue('--wb-line').trim() || '#d8e0ec',
  };
}

function ChartCard({
  title,
  subtitle,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`wb-card-pad flex flex-col min-h-[320px] ${className}`}>
      <div className="mb-4">
        <h3 className="font-display text-sm font-semibold text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-ink-subtle mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex-1 min-h-[240px] w-full">{children}</div>
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
    <div className="wb-stat">
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
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fill: theme.tick, fontSize: 11 }} />
            <YAxis
              type="category"
              dataKey="name"
              width={120}
              tick={{ fill: theme.tick, fontSize: 11 }}
            />
            <Tooltip
              cursor={{ fill: 'rgba(19,199,232,0.08)' }}
              contentStyle={{
                background: theme.tooltipBg,
                border: `1px solid ${theme.tooltipBorder}`,
                borderRadius: 12,
                fontSize: 12,
              }}
              formatter={(value) => [String(value), 'Count']}
              labelFormatter={(_, payload) => (payload?.[0]?.payload as { fullName?: string })?.fullName || ''}
            />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16}>
              {data.map((entry) => (
                <Cell key={entry.fullName} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
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
  const data = rows.map((r, i) => ({
    name: r.label,
    value: r.count,
    fill: colorForLabel(r.label, i),
  }));
  const hasData = data.some((d) => d.value > 0);

  return (
    <ChartCard title={title} subtitle={subtitle}>
      {!hasData ? (
        <EmptyChart />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
            <XAxis
              dataKey="name"
              interval={0}
              angle={-28}
              textAnchor="end"
              height={60}
              tick={{ fill: theme.tick, fontSize: 10 }}
            />
            <YAxis allowDecimals={false} tick={{ fill: theme.tick, fontSize: 11 }} />
            <Tooltip
              cursor={{ fill: 'rgba(19,199,232,0.08)' }}
              contentStyle={{
                background: theme.tooltipBg,
                border: `1px solid ${theme.tooltipBorder}`,
                borderRadius: 12,
                fontSize: 12,
              }}
            />
            <Bar dataKey="value" name="Use cases" radius={[6, 6, 0, 0]} barSize={28}>
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
              <LabelList
                dataKey="value"
                position="top"
                style={{ fill: theme.tick, fontSize: 11, fontWeight: 600 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
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
        <div className="relative h-full w-full">
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
              >
                {data.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill || CHART_COLORS[0]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: theme.tooltipBg,
                  border: `1px solid ${theme.tooltipBorder}`,
                  borderRadius: 12,
                  fontSize: 12,
                }}
              />
              <Legend
                verticalAlign="bottom"
                height={48}
                wrapperStyle={{ fontSize: 11, color: theme.tick }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-x-0 top-[38%] flex flex-col items-center">
            <span className="text-[11px] uppercase tracking-wide text-ink-subtle">Total</span>
            <span className="font-display text-2xl font-semibold text-ink tabular-nums">{total}</span>
          </div>
        </div>
      )}
    </ChartCard>
  );
}
