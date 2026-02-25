import { Chart as ChartJS, type ChartOptions, type Plugin } from 'chart.js';

// ── Color constants ──
export const COLORS = {
  profit: '#4ec9b0',
  profitRgb: '78,201,176',
  loss: '#f48771',
  lossRgb: '244,135,113',
  accent: '#dcdcaa',
  accentRgb: '220,220,170',
  grid: '#2a2a2e',
  gridLight: '#3e3e42',
  textMuted: '#858585',
  bgCard: '#252526',
  bgPrimary: '#1e1e1e',
};

// ── Font config ──
const FONT = { family: 'JetBrains Mono', size: 10 };

// ── Shared axis/grid configuration ──
export const CHART_GRID = { color: COLORS.grid, drawBorder: false };
export const CHART_TICKS = { color: COLORS.textMuted, font: FONT };

// ── Gradient factory ──
export function createGradient(
  ctx: CanvasRenderingContext2D,
  chartArea: { top: number; bottom: number },
  colorRgb: string,
  topOpacity = 0.25,
  bottomOpacity = 0
): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  gradient.addColorStop(0, `rgba(${colorRgb},${topOpacity})`);
  gradient.addColorStop(0.6, `rgba(${colorRgb},${bottomOpacity + 0.03})`);
  gradient.addColorStop(1, `rgba(${colorRgb},${bottomOpacity})`);
  return gradient;
}

// ── Bar gradient factory (vertical, top to bottom) ──
export function createBarGradient(
  ctx: CanvasRenderingContext2D,
  chartArea: { top: number; bottom: number },
  colorRgb: string,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  gradient.addColorStop(0, `rgba(${colorRgb},0.9)`);
  gradient.addColorStop(1, `rgba(${colorRgb},0.4)`);
  return gradient;
}

// ── Crosshair plugin ──
export const crosshairPlugin: Plugin = {
  id: 'crosshair',
  afterDraw(chart) {
    const tooltip = chart.tooltip;
    if (!tooltip || !tooltip.getActiveElements().length) return;
    const { ctx, chartArea } = chart;
    const x = tooltip.caretX;
    if (x < chartArea.left || x > chartArea.right) return;

    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${COLORS.accentRgb},0.4)`;
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

// Register the crosshair plugin globally
ChartJS.register(crosshairPlugin);

// ── Custom tooltip config ──
export const tooltipConfig = {
  enabled: true,
  backgroundColor: 'rgba(30,30,30,0.95)',
  borderColor: COLORS.gridLight,
  borderWidth: 1,
  titleColor: COLORS.accent,
  titleFont: { ...FONT, weight: 'bold' as const },
  bodyColor: '#d4d4d4',
  bodyFont: FONT,
  padding: { top: 10, bottom: 10, left: 14, right: 14 },
  cornerRadius: 8,
  displayColors: false,
  caretSize: 0,
  boxPadding: 4,
};

// ── Animation presets ──
export const lineAnimation = {
  x: { duration: 800, easing: 'easeOutQuart' as const },
  y: { duration: 600, easing: 'easeOutQuart' as const, delay: 100 },
};

export const barAnimation = {
  y: { duration: 600, easing: 'easeOutQuart' as const },
  x: { duration: 400, easing: 'easeOutQuart' as const },
};

export const doughnutAnimation = {
  animateRotate: true,
  animateScale: true,
};

// ── Hover config for bars ──
export const barHoverConfig = {
  hoverBackgroundColor: undefined as string | undefined, // set dynamically
  hoverBorderWidth: 2,
  hoverBorderColor: undefined as string | undefined,
};

// ── Common line chart options builder ──
export function lineChartOptions(overrides?: Partial<ChartOptions<'line'>>): ChartOptions<'line'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...tooltipConfig,
        mode: 'index',
        intersect: false,
      },
    },
    scales: {
      x: {
        type: 'time',
        grid: { ...CHART_GRID, display: false },
        ticks: CHART_TICKS,
        border: { display: false },
      },
      y: {
        grid: CHART_GRID,
        ticks: CHART_TICKS,
        border: { display: false },
      },
    },
    animation: lineAnimation as any,
    ...overrides,
  };
}

// ── Common bar chart options builder ──
export function barChartOptions(overrides?: Partial<ChartOptions<'bar'>>): ChartOptions<'bar'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...tooltipConfig,
        mode: 'index',
        intersect: false,
      },
    },
    scales: {
      x: {
        grid: { ...CHART_GRID, display: false },
        ticks: CHART_TICKS,
        border: { display: false },
      },
      y: {
        grid: CHART_GRID,
        ticks: CHART_TICKS,
        border: { display: false },
      },
    },
    animation: barAnimation as any,
    ...overrides,
  };
}

// ── Line dataset defaults ──
export function lineDatasetDefaults(color: string, _colorRgb?: string, perTrade = false) {
  return {
    borderColor: color,
    borderWidth: 2.5,
    pointRadius: perTrade ? 1.5 : 0,
    pointHoverRadius: 5,
    pointHoverBackgroundColor: color,
    pointHoverBorderColor: '#1e1e1e',
    pointHoverBorderWidth: 2,
    tension: perTrade ? 0 : 0.4,
    ...(perTrade ? {} : { cubicInterpolationMode: 'monotone' as const }),
    fill: true,
    // backgroundColor will be set dynamically via gradient
  };
}

// ── Bar color arrays with gradient support ──
export function barColors(data: number[]): string[] {
  return data.map(v => v >= 0
    ? `rgba(${COLORS.profitRgb},0.75)`
    : `rgba(${COLORS.lossRgb},0.75)`
  );
}

export function barBorderColors(data: number[]): string[] {
  return data.map(v => v >= 0 ? COLORS.profit : COLORS.loss);
}

export function barHoverColors(data: number[]): string[] {
  return data.map(v => v >= 0
    ? `rgba(${COLORS.profitRgb},0.95)`
    : `rgba(${COLORS.lossRgb},0.95)`
  );
}

// ── Data aggregation utility ──
export type AggregationLevel = 'trade' | 'daily' | 'weekly' | 'monthly';

interface DataPoint {
  x: Date;
  y: number;
}

interface TradeDataInput {
  open_time: number;
  pnl: number;
  fees: number;
}

function getDateKey(date: Date, level: AggregationLevel): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');

  switch (level) {
    case 'daily':
      return `${y}-${m}-${d}`;
    case 'weekly': {
      // Get Monday of the week
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(date);
      monday.setDate(diff);
      monday.setHours(0, 0, 0, 0);
      return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
    }
    case 'monthly':
      return `${y}-${m}`;
    default:
      return date.toISOString();
  }
}

export function aggregateEquityData(
  trades: TradeDataInput[],
  level: AggregationLevel
): DataPoint[] {
  const sorted = [...trades].sort((a, b) => a.open_time - b.open_time);

  if (level === 'trade') {
    let cum = 0;
    return sorted.map(t => {
      cum += t.pnl - t.fees;
      return { x: new Date(t.open_time), y: parseFloat(cum.toFixed(2)) };
    });
  }

  // Aggregate by time period
  const buckets: Record<string, { date: Date; netPnl: number }> = {};
  for (const t of sorted) {
    const date = new Date(t.open_time);
    const key = getDateKey(date, level);
    if (!buckets[key]) {
      buckets[key] = { date: new Date(key + (level === 'monthly' ? '-01' : '')), netPnl: 0 };
    }
    buckets[key].netPnl += t.pnl - t.fees;
  }

  const sortedBuckets = Object.values(buckets).sort((a, b) => a.date.getTime() - b.date.getTime());
  let cum = 0;
  return sortedBuckets.map(b => {
    cum += b.netPnl;
    return { x: b.date, y: parseFloat(cum.toFixed(2)) };
  });
}

export interface EquityChartData {
  points: DataPoint[] | { x: number; y: number }[];
  tradeDates: Date[];
  isPerTrade: boolean;
}

export function prepareEquityChartData(
  trades: TradeDataInput[],
  level: AggregationLevel
): EquityChartData {
  const raw = aggregateEquityData(trades, level);

  if (level !== 'trade') {
    return { points: raw, tradeDates: [], isPerTrade: false };
  }

  const tradeDates = raw.map(p => p.x);
  const points = raw.map((p, i) => ({ x: i, y: p.y }));
  return { points, tradeDates, isPerTrade: true };
}

export function perTradeScaleOverrides(
  totalTrades: number,
): Partial<ChartOptions<'line'>> {
  return {
    scales: {
      x: {
        type: 'linear' as const,
        grid: { ...CHART_GRID, display: false },
        ticks: {
          ...CHART_TICKS,
          maxTicksLimit: 8,
          callback(value: any) {
            const idx = Math.round(value as number);
            if (idx < 0 || idx >= totalTrades) return '';
            return `#${idx + 1}`;
          },
        },
        border: { display: false },
        min: 0,
        max: Math.max(totalTrades - 1, 0),
      },
      y: {
        grid: CHART_GRID,
        ticks: CHART_TICKS,
        border: { display: false },
      },
    },
  };
}

export function aggregateDrawdownData(equityData: DataPoint[]): DataPoint[] {
  let peak = 0;
  return equityData.map(p => {
    if (p.y > peak) peak = p.y;
    const dd = peak > 0 ? parseFloat(((p.y - peak) / peak * 100).toFixed(2)) : 0;
    return { x: p.x, y: dd };
  });
}
