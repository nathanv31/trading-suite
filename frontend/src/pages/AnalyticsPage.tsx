import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, ArcElement, TimeScale, Filler, Tooltip, Legend,
} from 'chart.js';
import 'chartjs-adapter-luxon';
import { Line, Bar, Doughnut, Scatter } from 'react-chartjs-2';
import { useTrades } from '../context/TradeContext';
import { useWallet } from '../context/WalletContext';
import { computeStats } from '../utils/tradeStats';
import { formatHold, formatCurrency, formatPnl } from '../utils/formatters';
import { getPnlSummary, getDailyFunding } from '../api/client';
import {
  COLORS, CHART_GRID, CHART_TICKS,
  aggregateEquityData, aggregateDrawdownData,
  prepareEquityChartData, perTradeScaleOverrides,
  lineChartOptions, barChartOptions, lineDatasetDefaults,
  createGradient, tooltipConfig,
  barColors as makeBarColors, barBorderColors, barHoverColors,
  type AggregationLevel,
} from '../utils/chartConfig';
import TagFilter from '../components/TagFilter';
import DateFilter from '../components/DateFilter';
import type { PnlSummary } from '../types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, TimeScale, Filler, Tooltip, Legend);

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];

const MAE_MFE_BUCKETS = [
  { label: '0-0.5%', min: 0, max: 0.5 },
  { label: '0.5-1%', min: 0.5, max: 1 },
  { label: '1-2%', min: 1, max: 2 },
  { label: '2-5%', min: 2, max: 5 },
  { label: '5%+', min: 5, max: Infinity },
];

const AGG_OPTIONS: { value: AggregationLevel; label: string }[] = [
  { value: 'trade', label: 'Per Trade' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

// Shared enhanced bar dataset builder
function enhancedBarDataset(data: number[], extraRadius = 6) {
  return {
    data,
    backgroundColor: makeBarColors(data),
    borderColor: barBorderColors(data),
    hoverBackgroundColor: barHoverColors(data),
    hoverBorderColor: barBorderColors(data),
    hoverBorderWidth: 2,
    borderWidth: 1,
    borderRadius: extraRadius,
    borderSkipped: false as const,
  };
}

// Shared enhanced bar options
function enhancedBarOpts(tooltipLabelCb?: (item: any) => string) {
  return barChartOptions({
    plugins: {
      legend: { display: false },
      tooltip: {
        ...tooltipConfig,
        mode: 'index' as const,
        intersect: false,
        callbacks: tooltipLabelCb ? { label: tooltipLabelCb } : undefined,
      },
    },
  });
}

export default function AnalyticsPage() {
  const { trades, loading, error, refreshTrades, tagMap, allTags } = useTrades();
  const { wallet } = useWallet();
  const [sideFilter, setSideFilter] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [coinFilter, setCoinFilter] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [tagLogic, setTagLogic] = useState<'any' | 'all'>('any');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dateGroupBy, setDateGroupBy] = useState<'open' | 'close'>('open');
  const [pnlSummary, setPnlSummary] = useState<PnlSummary | null>(null);
  const [dailyFunding, setDailyFunding] = useState<Record<string, number>>({});
  const [equityAgg, setEquityAgg] = useState<AggregationLevel>('daily');
  const [ddAgg, setDdAgg] = useState<AggregationLevel>('daily');
  const equityChartRef = useRef<ChartJS<'line'> | null>(null) as any;
  const ddChartRef = useRef<ChartJS<'line'> | null>(null) as any;

  useEffect(() => {
    if (wallet && trades.length > 0) {
      getPnlSummary(wallet).then(setPnlSummary).catch(() => {});
      getDailyFunding(wallet).then(setDailyFunding).catch(() => {});
    }
  }, [wallet, trades]);

  const coins = useMemo(() => [...new Set(trades.map(t => t.coin))].sort(), [trades]);

  const filtered = useMemo(() => {
    let list = [...trades];

    if (dateFrom) {
      const fromTs = new Date(dateFrom + 'T00:00:00').getTime();
      list = list.filter(t => {
        const ts = dateGroupBy === 'close' && t.close_time ? t.close_time : t.open_time;
        return ts >= fromTs;
      });
    }
    if (dateTo) {
      const toTs = new Date(dateTo + 'T23:59:59.999').getTime();
      list = list.filter(t => {
        const ts = dateGroupBy === 'close' && t.close_time ? t.close_time : t.open_time;
        return ts <= toTs;
      });
    }

    if (sideFilter) list = list.filter(t => t.side === sideFilter);
    if (resultFilter === 'win') list = list.filter(t => (t.pnl - t.fees) > 0);
    if (resultFilter === 'loss') list = list.filter(t => (t.pnl - t.fees) < 0);
    if (coinFilter) list = list.filter(t => t.coin === coinFilter);

    if (selectedTags.size > 0) {
      list = list.filter(t => {
        const tradeTags = tagMap[String(t.id)] || [];
        if (tagLogic === 'any') {
          return tradeTags.some(tag => selectedTags.has(tag));
        } else {
          return [...selectedTags].every(tag => tradeTags.includes(tag));
        }
      });
    }

    return list;
  }, [trades, sideFilter, resultFilter, coinFilter, selectedTags, tagLogic, tagMap, dateFrom, dateTo, dateGroupBy]);

  const stats = useMemo(() => filtered.length > 0 ? computeStats(filtered) : null, [filtered]);
  const sorted = useMemo(() => [...filtered].sort((a, b) => a.open_time - b.open_time), [filtered]);

  // Use funding-inclusive pnlSummary when filters don't actually remove any trades
  // (e.g. filtering by BTC when the wallet only has BTC trades).
  const allTradesShown = filtered.length === trades.length;

  // ── Equity curve (aggregated) ──
  const chartFunding = allTradesShown ? dailyFunding : undefined;
  const equityChart = useMemo(() => {
    const chart = prepareEquityChartData(filtered, equityAgg, chartFunding);
    // When all trades shown, adjust so final value matches pnlSummary.net_pnl exactly.
    if (!allTradesShown || !pnlSummary || chart.points.length === 0) return chart;
    const pts = chart.points;
    const rawFinal = pts[pts.length - 1].y;
    const target = parseFloat(pnlSummary.net_pnl.toFixed(2));
    const adj = target - rawFinal;
    if (Math.abs(adj) < 0.005) return chart;
    const n = pts.length;
    const adjusted = pts.map((p, i) => ({
      ...p,
      y: parseFloat((p.y + adj * ((i + 1) / n)).toFixed(2)),
    }));
    return { ...chart, points: adjusted };
  }, [filtered, equityAgg, chartFunding, allTradesShown, pnlSummary]);
  const equityData = equityChart.points;
  const equityFinal = equityData.length > 0 ? equityData[equityData.length - 1].y : 0;
  const equityIsProfit = equityFinal >= 0;
  const equityColor = equityIsProfit ? COLORS.profit : COLORS.loss;
  const equityColorRgb = equityIsProfit ? COLORS.profitRgb : COLORS.lossRgb;

  // ── Drawdown (aggregated) ──
  const ddChart = useMemo(() => prepareEquityChartData(filtered, ddAgg, chartFunding), [filtered, ddAgg, chartFunding]);
  const drawdownRaw = useMemo(() => aggregateDrawdownData(aggregateEquityData(filtered, ddAgg, chartFunding)), [filtered, ddAgg, chartFunding]);
  const drawdownData = useMemo(() => {
    if (!ddChart.isPerTrade) return drawdownRaw;
    return drawdownRaw.map((p, i) => ({ x: i, y: p.y }));
  }, [drawdownRaw, ddChart.isPerTrade]);

  // ── Day of week ──
  const dowData = useMemo(() => {
    const pnl = [0, 0, 0, 0, 0, 0, 0];
    filtered.forEach(t => pnl[new Date(t.open_time).getDay()] += t.pnl - t.fees);
    return { labels: DOW_ORDER.map(i => DAYS[i]), data: DOW_ORDER.map(i => parseFloat(pnl[i].toFixed(2))) };
  }, [filtered]);

  // ── Time of day ──
  const todData = useMemo(() => {
    const labels = ['00-04', '04-08', '08-12', '12-16', '16-20', '20-24'];
    const pnl = [0, 0, 0, 0, 0, 0];
    filtered.forEach(t => { const h = new Date(t.open_time).getHours(); pnl[Math.floor(h / 4)] += t.pnl - t.fees; });
    return { labels, data: pnl.map(v => parseFloat(v.toFixed(2))) };
  }, [filtered]);

  // ── Hold time buckets ──
  const holdData = useMemo(() => {
    const buckets: Record<string, number> = { '<1m': 0, '1-5m': 0, '5-30m': 0, '30m-4h': 0, '4h-1d': 0, '>1d': 0 };
    filtered.forEach(t => {
      const m = (t.hold_ms || 0) / 60000;
      const net = t.pnl - t.fees;
      if (m < 1) buckets['<1m'] += net;
      else if (m < 5) buckets['1-5m'] += net;
      else if (m < 30) buckets['5-30m'] += net;
      else if (m < 240) buckets['30m-4h'] += net;
      else if (m < 1440) buckets['4h-1d'] += net;
      else buckets['>1d'] += net;
    });
    return { labels: Object.keys(buckets), data: Object.values(buckets).map(v => parseFloat(v.toFixed(2))) };
  }, [filtered]);

  // ── Coin PnL ──
  const coinData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(t => { map[t.coin] = (map[t.coin] || 0) + t.pnl - t.fees; });
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    return { labels: entries.map(e => e[0]), data: entries.map(e => parseFloat(e[1].toFixed(2))) };
  }, [filtered]);

  // ── Streak ──
  const streakData = useMemo(() => {
    let sk = 0;
    return sorted.map((t, i) => {
      const n = t.pnl - t.fees;
      const prev = i > 0 ? sorted[i - 1] : null;
      const pn = prev ? prev.pnl - prev.fees : 0;
      if (!prev) sk = n > 0 ? 1 : -1;
      else if (n > 0 && pn > 0) sk = sk > 0 ? sk + 1 : 1;
      else if (n < 0 && pn < 0) sk = sk < 0 ? sk - 1 : -1;
      else sk = n > 0 ? 1 : -1;
      return { x: new Date(t.open_time), y: sk };
    });
  }, [sorted]);

  // ── Distribution ──
  const distData = useMemo(() => {
    const pnls = filtered.map(t => t.pnl - t.fees);
    if (!pnls.length) return { labels: [] as string[], data: [] as number[], colors: [] as string[] };
    const minP = Math.min(...pnls), maxP = Math.max(...pnls);
    const bc = 12, bs = (maxP - minP) / bc || 1;
    const db = Array(bc).fill(0) as number[];
    pnls.forEach(p => { const i = Math.min(Math.floor((p - minP) / bs), bc - 1); db[i]++; });
    const dl = db.map((_, i) => `$${(minP + i * bs).toFixed(0)}`);
    const dc = dl.map(l => parseFloat(l.slice(1)) >= 0 ? `rgba(${COLORS.profitRgb},0.75)` : `rgba(${COLORS.lossRgb},0.75)`);
    return { labels: dl, data: db, colors: dc };
  }, [filtered]);

  // ── Win Rate by MAE bucket ──
  const maeWinRateData = useMemo(() => {
    const withMae = filtered.filter(t => t.mae != null);
    const counts = MAE_MFE_BUCKETS.map(() => 0);
    const wins = MAE_MFE_BUCKETS.map(() => 0);
    withMae.forEach(t => {
      const pct = (t.mae!) * 100;
      const idx = MAE_MFE_BUCKETS.findIndex(b => pct >= b.min && pct < b.max);
      const i = idx >= 0 ? idx : MAE_MFE_BUCKETS.length - 1;
      counts[i]++;
      if ((t.pnl - t.fees) > 0) wins[i]++;
    });
    const losses = counts.map((c, i) => c - wins[i]);
    return {
      labels: MAE_MFE_BUCKETS.map(b => b.label),
      data: counts.map((c, i) => c > 0 ? parseFloat((wins[i] / c * 100).toFixed(1)) : 0),
      wins,
      losses,
      counts,
    };
  }, [filtered]);

  // ── MAE stop-loss cutoff: max MAE among winners ──
  const maeCutoff = useMemo(() => {
    const winners = filtered.filter(t => t.mae != null && (t.pnl - t.fees) > 0);
    if (!winners.length) return null;
    const maxMae = Math.max(...winners.map(t => t.mae! * 100));
    return parseFloat(maxMae.toFixed(2));
  }, [filtered]);

  // ── Expectancy by MFE bucket ──
  const mfeExpectancyData = useMemo(() => {
    const withMfe = filtered.filter(t => t.mfe != null);
    const buckets = MAE_MFE_BUCKETS.map(() => [] as number[]);
    withMfe.forEach(t => {
      const pct = (t.mfe!) * 100;
      const idx = MAE_MFE_BUCKETS.findIndex(b => pct >= b.min && pct < b.max);
      const i = idx >= 0 ? idx : MAE_MFE_BUCKETS.length - 1;
      buckets[i].push(t.pnl - t.fees);
    });
    return {
      labels: MAE_MFE_BUCKETS.map(b => b.label),
      data: buckets.map(b => {
        if (!b.length) return 0;
        const w = b.filter(v => v > 0);
        const l = b.filter(v => v < 0);
        const wr = w.length / b.length;
        const avgW = w.length ? w.reduce((s, v) => s + v, 0) / w.length : 0;
        const avgL = l.length ? Math.abs(l.reduce((s, v) => s + v, 0) / l.length) : 0;
        return parseFloat((wr * avgW - (1 - wr) * avgL).toFixed(2));
      }),
      counts: buckets.map(b => b.length),
    };
  }, [filtered]);

  // ── Gradient callback for equity ──
  const getEquityGradient = useCallback(() => {
    const chart = equityChartRef.current;
    if (!chart?.chartArea) return `rgba(${equityColorRgb},0.1)`;
    return createGradient(chart.ctx, chart.chartArea, equityColorRgb, 0.25, 0);
  }, [equityColorRgb]);

  // ── Gradient callback for drawdown ──
  const getDdGradient = useCallback(() => {
    const chart = ddChartRef.current;
    if (!chart?.chartArea) return `rgba(${COLORS.lossRgb},0.12)`;
    return createGradient(chart.ctx, chart.chartArea, COLORS.lossRgb, 0.22, 0);
  }, []);

  // ── Update gradients on data change ──
  useEffect(() => {
    const chart = equityChartRef.current;
    if (chart?.chartArea && chart.data.datasets[0]) {
      chart.data.datasets[0].backgroundColor = createGradient(chart.ctx, chart.chartArea, equityColorRgb, 0.25, 0);
      chart.update('none');
    }
  }, [equityData, equityColorRgb]);

  useEffect(() => {
    const chart = ddChartRef.current;
    if (chart?.chartArea && chart.data.datasets[0]) {
      chart.data.datasets[0].backgroundColor = createGradient(chart.ctx, chart.chartArea, COLORS.lossRgb, 0.22, 0);
      chart.update('none');
    }
  }, [drawdownData]);

  if (loading) {
    return <div className="flex items-center justify-center" style={{ height: 200 }}><div className="spinner" /></div>;
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="metric-card" style={{ padding: 32, textAlign: 'center' }}>
          <div className="loss-text mb-2" style={{ fontSize: 14 }}>Failed to load trades</div>
          <div className="secondary-text mb-4" style={{ fontSize: 13 }}>{error}</div>
          <button className="btn-primary" onClick={refreshTrades} disabled={loading}>
            {loading ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  if (!stats) {
    return <div className="p-6 secondary-text">No trades match the current filters.</div>;
  }

  const displayNetPnl = (allTradesShown && pnlSummary) ? pnlSummary.net_pnl : stats.netPnl;
  const fundingSub = (allTradesShown && pnlSummary?.total_funding !== null && pnlSummary?.total_funding !== undefined)
    ? `Funding ${formatPnl(pnlSummary.total_funding)}`
    : `Realized ${formatCurrency(stats.realizedPnl)}`;

  const statCards = [
    { label: 'Net PnL', value: formatCurrency(displayNetPnl), cls: displayNetPnl >= 0 ? 'profit-text' : 'loss-text', sub: fundingSub },
    { label: 'Win Rate', value: `${stats.winRate.toFixed(1)}%`, cls: stats.winRate >= 50 ? 'profit-text' : 'loss-text', sub: `${stats.wins}W / ${stats.losses}L` },
    { label: 'Profit Factor', value: stats.profitFactor.toFixed(2), cls: stats.profitFactor >= 1 ? 'profit-text' : 'loss-text', sub: `W ${formatCurrency(stats.avgWin)} / L ${formatCurrency(stats.avgLoss)}` },
    { label: 'Avg R:R', value: stats.avgRR.toFixed(2), cls: stats.avgRR >= 1 ? 'profit-text' : 'loss-text', sub: `Sharpe ${stats.sharpe.toFixed(2)}` },
    { label: 'Max Drawdown', value: `-${formatCurrency(stats.maxDrawdown)}`, cls: 'loss-text', sub: `Sortino ${stats.sortino.toFixed(2)}` },
    { label: 'Total Trades', value: String(filtered.length), cls: 'accent-text', sub: `Avg hold ${formatHold(stats.avgHoldMs)}` },
    { label: 'Total Fees', value: `-${formatCurrency(stats.totalFees)}`, cls: 'loss-text', sub: `Per trade -${formatCurrency(stats.totalFees / filtered.length)}` },
    { label: 'Avg Win', value: `+${formatCurrency(stats.avgWin)}`, cls: 'profit-text', sub: `Best ${formatCurrency(stats.bestTrade)}` },
    { label: 'Avg Loss', value: `-${formatCurrency(stats.avgLoss)}`, cls: 'loss-text', sub: `Worst ${formatCurrency(stats.worstTrade)}` },
    { label: 'Expectancy', value: formatCurrency(stats.expectancy), cls: stats.expectancy >= 0 ? 'profit-text' : 'loss-text', sub: 'per trade' },
    ...(maeCutoff !== null ? [{ label: 'MAE Cutoff', value: `${maeCutoff}%`, cls: 'accent-text', sub: '0% WR beyond' }] : []),
  ];

  // Tooltip label for PnL values
  const pnlTooltipLabel = (item: any) => `  P&L: ${formatCurrency(item.parsed.y)}`;
  const countTooltipLabel = (item: any) => `  Trades: ${item.parsed.y}`;

  return (
    <div className="p-6">
      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap items-center">
        <select className="filter-select" value={sideFilter} onChange={e => setSideFilter(e.target.value)}>
          <option value="">All Sides</option><option value="B">Long</option><option value="A">Short</option>
        </select>
        <select className="filter-select" value={resultFilter} onChange={e => setResultFilter(e.target.value)}>
          <option value="">Win / Loss</option><option value="win">Wins</option><option value="loss">Losses</option>
        </select>
        <select className="filter-select" value={coinFilter} onChange={e => setCoinFilter(e.target.value)}>
          <option value="">All Coins</option>
          {coins.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <TagFilter
          allTags={allTags}
          selectedTags={selectedTags}
          logic={tagLogic}
          onTagsChange={setSelectedTags}
          onLogicChange={setTagLogic}
        />
        <DateFilter
          from={dateFrom}
          to={dateTo}
          onApply={(from, to, groupBy) => {
            setDateGroupBy(groupBy);
            setDateFrom(from);
            setDateTo(to);
          }}
          onClear={() => {
            setDateFrom('');
            setDateTo('');
          }}
        />
        <div className="ml-auto secondary-text text-xs">{filtered.length} trades</div>
      </div>

      {/* Stat Cards */}
      <div className="an-stat-grid mb-4">
        {statCards.map(c => (
          <div key={c.label} className="an-stat-card">
            <div className="an-stat-label">{c.label}</div>
            <div className={`an-stat-value ${c.cls}`}>{c.value}</div>
            <div className="an-stat-sub">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="an-module-grid">
        {/* ── Equity Curve ── */}
        <div className="an-module span2">
          <div className="an-module-header">
            <span className="an-chart-title">Cumulative P&L</span>
            <div className="chart-agg-toggle">
              {AGG_OPTIONS.map(opt => (
                <button key={opt.value} className={`chart-agg-btn${equityAgg === opt.value ? ' active' : ''}`} onClick={() => setEquityAgg(opt.value)}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ height: 220 }}>
            <Line
              ref={equityChartRef}
              data={{
                datasets: [{
                  data: equityData as any,
                  ...lineDatasetDefaults(equityColor, equityColorRgb, equityChart.isPerTrade),
                  backgroundColor: getEquityGradient(),
                }],
              }}
              options={lineChartOptions({
                ...(equityChart.isPerTrade ? perTradeScaleOverrides(equityChart.tradeDates.length) : {}),
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    ...tooltipConfig,
                    mode: 'index' as const,
                    intersect: false,
                    callbacks: {
                      title: (items) => {
                        if (!items.length) return '';
                        if (equityChart.isPerTrade) {
                          const idx = Math.round(items[0].parsed.x ?? 0);
                          const date = equityChart.tradeDates[idx];
                          const dateStr = date ? date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
                          return `Trade #${idx + 1} \u2014 ${dateStr}`;
                        }
                        const d = new Date(items[0].parsed.x ?? 0);
                        if (equityAgg === 'monthly') return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
                        if (equityAgg === 'weekly') return `Week of ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
                        return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
                      },
                      label: (item) => `  Cumulative: ${formatCurrency(item.parsed.y ?? 0)}`,
                    },
                  },
                },
              })}
            />
          </div>
        </div>

        {/* ── Drawdown ── */}
        <div className="an-module">
          <div className="an-module-header">
            <span className="an-chart-title">Drawdown</span>
            <div className="chart-agg-toggle sm">
              {AGG_OPTIONS.map(opt => (
                <button key={opt.value} className={`chart-agg-btn${ddAgg === opt.value ? ' active' : ''}`} onClick={() => setDdAgg(opt.value)}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ height: 220 }}>
            <Line
              ref={ddChartRef}
              data={{
                datasets: [{
                  data: drawdownData as any,
                  ...lineDatasetDefaults(COLORS.loss, COLORS.lossRgb, ddChart.isPerTrade),
                  borderWidth: 2,
                  backgroundColor: getDdGradient(),
                }],
              }}
              options={lineChartOptions({
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    ...tooltipConfig,
                    mode: 'index' as const,
                    intersect: false,
                    callbacks: {
                      title: ddChart.isPerTrade ? (items) => {
                        if (!items.length) return '';
                        const idx = Math.round(items[0].parsed.x ?? 0);
                        const date = ddChart.tradeDates[idx];
                        const dateStr = date ? date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
                        return `Trade #${idx + 1} \u2014 ${dateStr}`;
                      } : undefined,
                      label: (item) => `  Drawdown: ${(item.parsed.y ?? 0).toFixed(2)}%`,
                    },
                  },
                },
                scales: ddChart.isPerTrade
                  ? {
                      ...perTradeScaleOverrides(ddChart.tradeDates.length).scales,
                      y: {
                        grid: CHART_GRID,
                        ticks: { ...CHART_TICKS, callback: (v: any) => v + '%' },
                        border: { display: false },
                      },
                    }
                  : {
                      x: {
                        type: 'time',
                        grid: { ...CHART_GRID, display: false },
                        ticks: CHART_TICKS,
                        border: { display: false },
                      },
                      y: {
                        grid: CHART_GRID,
                        ticks: { ...CHART_TICKS, callback: (v: any) => v + '%' },
                        border: { display: false },
                      },
                    },
              })}
            />
          </div>
        </div>

        {/* ── Day of Week ── */}
        <div className="an-module">
          <div className="an-module-header"><span className="an-chart-title">P&L by Day of Week</span></div>
          <div style={{ height: 200 }}>
            <Bar
              data={{ labels: dowData.labels, datasets: [enhancedBarDataset(dowData.data)] }}
              options={enhancedBarOpts(pnlTooltipLabel) as any}
            />
          </div>
        </div>

        {/* ── Time of Day ── */}
        <div className="an-module">
          <div className="an-module-header"><span className="an-chart-title">P&L by Time of Day</span></div>
          <div style={{ height: 200 }}>
            <Bar
              data={{ labels: todData.labels, datasets: [enhancedBarDataset(todData.data)] }}
              options={enhancedBarOpts(pnlTooltipLabel) as any}
            />
          </div>
        </div>

        {/* ── Hold Time ── */}
        <div className="an-module">
          <div className="an-module-header"><span className="an-chart-title">P&L by Hold Time</span></div>
          <div style={{ height: 200 }}>
            <Bar
              data={{ labels: holdData.labels, datasets: [enhancedBarDataset(holdData.data)] }}
              options={enhancedBarOpts(pnlTooltipLabel) as any}
            />
          </div>
        </div>

        {/* ── Coin PnL ── */}
        <div className="an-module span2">
          <div className="an-module-header"><span className="an-chart-title">P&L by Asset</span></div>
          <div style={{ height: 200 }}>
            <Bar
              data={{ labels: coinData.labels, datasets: [enhancedBarDataset(coinData.data)] }}
              options={enhancedBarOpts(pnlTooltipLabel) as any}
            />
          </div>
        </div>

        {/* ── Long vs Short ── */}
        <div className="an-module">
          <div className="an-module-header"><span className="an-chart-title">Long vs Short</span></div>
          <div style={{ height: 200 }}>
            <Doughnut
              data={{
                labels: [`Long (${stats.longCount})`, `Short (${stats.shortCount})`],
                datasets: [{
                  data: [stats.longCount, stats.shortCount],
                  backgroundColor: [`rgba(${COLORS.profitRgb},0.75)`, `rgba(${COLORS.lossRgb},0.75)`],
                  hoverBackgroundColor: [COLORS.profit, COLORS.loss],
                  borderWidth: 0,
                  spacing: 3,
                }],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                animation: { animateRotate: true, animateScale: true },
                plugins: {
                  legend: {
                    display: true,
                    position: 'bottom',
                    labels: { color: COLORS.textMuted, font: { family: 'JetBrains Mono', size: 10 }, padding: 10, usePointStyle: true, pointStyleWidth: 8 },
                  },
                  tooltip: {
                    ...tooltipConfig,
                    callbacks: {
                      label: (item) => {
                        const total = (item.dataset.data as number[]).reduce((a, b) => a + b, 0);
                        const pct = total > 0 ? ((item.raw as number) / total * 100).toFixed(1) : '0';
                        return `  ${item.label}: ${item.raw} (${pct}%)`;
                      },
                    },
                  },
                },
              }}
            />
          </div>
        </div>

        {/* ── Distribution ── */}
        <div className="an-module">
          <div className="an-module-header"><span className="an-chart-title">P&L Distribution</span></div>
          <div style={{ height: 200 }}>
            <Bar
              data={{
                labels: distData.labels,
                datasets: [{
                  data: distData.data,
                  backgroundColor: distData.colors,
                  hoverBackgroundColor: distData.colors.map(c => c.replace(/0\.75/, '0.95')),
                  borderWidth: 0,
                  borderRadius: 4,
                  borderSkipped: false,
                }],
              }}
              options={enhancedBarOpts(countTooltipLabel) as any}
            />
          </div>
        </div>

        {/* ── Streak ── */}
        <div className="an-module">
          <div className="an-module-header"><span className="an-chart-title">Win / Loss Streak</span></div>
          <div style={{ height: 200 }}>
            <Bar
              data={{
                datasets: [{
                  data: streakData,
                  backgroundColor: streakData.map(d => d.y > 0 ? `rgba(${COLORS.profitRgb},0.75)` : `rgba(${COLORS.lossRgb},0.75)`),
                  hoverBackgroundColor: streakData.map(d => d.y > 0 ? COLORS.profit : COLORS.loss),
                  borderWidth: 0,
                  borderRadius: 3,
                  borderSkipped: false,
                }],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    ...tooltipConfig,
                    callbacks: {
                      title: (items: any[]) => {
                        if (!items.length) return '';
                        return new Date(items[0].parsed.x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                      },
                      label: (item: any) => {
                        const v = item.parsed.y;
                        return `  Streak: ${v > 0 ? '+' : ''}${v} ${v > 0 ? 'wins' : 'losses'}`;
                      },
                    },
                  },
                },
                scales: {
                  x: { type: 'time', grid: { ...CHART_GRID, display: false }, ticks: CHART_TICKS, border: { display: false } },
                  y: { grid: CHART_GRID, ticks: CHART_TICKS, border: { display: false } },
                },
              } as any}
            />
          </div>
        </div>

        {/* ── Win Rate by MAE ── */}
        <div className="an-module">
          <div className="an-module-header">
            <span className="an-chart-title">Win Rate by MAE</span>
            {maeCutoff !== null && <span className="secondary-text" style={{ fontSize: 11, marginLeft: 8 }}>Stop cutoff: {maeCutoff}%</span>}
          </div>
          <div style={{ height: 200 }}>
            <Bar
              data={{
                labels: maeWinRateData.labels,
                datasets: [
                  {
                    label: 'Wins',
                    data: maeWinRateData.wins,
                    backgroundColor: `rgba(${COLORS.profitRgb},0.75)`,
                    hoverBackgroundColor: COLORS.profit,
                    borderWidth: 0,
                    borderRadius: { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 },
                    borderSkipped: false as const,
                  },
                  {
                    label: 'Losses',
                    data: maeWinRateData.losses,
                    backgroundColor: `rgba(${COLORS.lossRgb},0.75)`,
                    hoverBackgroundColor: COLORS.loss,
                    borderWidth: 0,
                    borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 6, bottomRight: 6 },
                    borderSkipped: false as const,
                  },
                ],
              }}
              options={barChartOptions({
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    ...tooltipConfig,
                    mode: 'index' as const,
                    intersect: false,
                    callbacks: {
                      label: (item: any) => {
                        const i = item.dataIndex;
                        if (item.datasetIndex === 1) return null;
                        return [
                          `  Win Rate: ${maeWinRateData.data[i]}%`,
                          `  Wins: ${maeWinRateData.wins[i]}  Losses: ${maeWinRateData.losses[i]}`,
                        ];
                      },
                    },
                  },
                },
                scales: {
                  x: { stacked: true, grid: { ...CHART_GRID, display: false }, ticks: CHART_TICKS, border: { display: false } },
                  y: { stacked: true, grid: CHART_GRID, ticks: CHART_TICKS, border: { display: false } },
                },
              }) as any}
            />
          </div>
        </div>

        {/* ── Expectancy by MFE ── */}
        <div className="an-module">
          <div className="an-module-header"><span className="an-chart-title">Expectancy by MFE</span></div>
          <div style={{ height: 200 }}>
            <Bar
              data={{ labels: mfeExpectancyData.labels, datasets: [enhancedBarDataset(mfeExpectancyData.data)] }}
              options={barChartOptions({
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    ...tooltipConfig,
                    mode: 'index' as const,
                    intersect: false,
                    callbacks: {
                      label: (item: any) => [
                        `  Expectancy: ${formatCurrency(item.parsed.y)}`,
                        `  Trades: ${mfeExpectancyData.counts[item.dataIndex]}`,
                      ],
                    },
                  },
                },
              }) as any}
            />
          </div>
        </div>

        {/* ── MAE vs MFE ── */}
        <div className="an-module">
          <div className="an-module-header"><span className="an-chart-title">MAE vs MFE</span></div>
          <div style={{ height: 200 }}>
            <Scatter
              data={{
                datasets: [
                  {
                    label: 'Win',
                    data: filtered.filter(t => (t.pnl - t.fees) > 0).map(t => ({ x: (t.mae || 0) * 100, y: (t.mfe || 0) * 100 })),
                    backgroundColor: `rgba(${COLORS.profitRgb},0.5)`,
                    hoverBackgroundColor: COLORS.profit,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBorderWidth: 1,
                    pointBorderColor: `rgba(${COLORS.profitRgb},0.8)`,
                    pointHoverBorderColor: COLORS.profit,
                    pointHoverBorderWidth: 2,
                  },
                  {
                    label: 'Loss',
                    data: filtered.filter(t => (t.pnl - t.fees) < 0).map(t => ({ x: (t.mae || 0) * 100, y: (t.mfe || 0) * 100 })),
                    backgroundColor: `rgba(${COLORS.lossRgb},0.5)`,
                    hoverBackgroundColor: COLORS.loss,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBorderWidth: 1,
                    pointBorderColor: `rgba(${COLORS.lossRgb},0.8)`,
                    pointHoverBorderColor: COLORS.loss,
                    pointHoverBorderWidth: 2,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'point', intersect: true },
                plugins: {
                  legend: {
                    display: true,
                    position: 'bottom',
                    labels: { color: COLORS.textMuted, font: { family: 'JetBrains Mono', size: 10 }, padding: 10, usePointStyle: true, pointStyleWidth: 8 },
                  },
                  tooltip: {
                    ...tooltipConfig,
                    callbacks: {
                      label: (item: any) => `  MAE: ${item.parsed.x.toFixed(2)}%  MFE: ${item.parsed.y.toFixed(2)}%`,
                    },
                  },
                },
                scales: {
                  x: {
                    grid: CHART_GRID,
                    ticks: { ...CHART_TICKS, callback: (v: any) => v + '%' },
                    title: { display: true, text: 'MAE %', color: COLORS.textMuted, font: { size: 10 } },
                    border: { display: false },
                  },
                  y: {
                    grid: CHART_GRID,
                    ticks: { ...CHART_TICKS, callback: (v: any) => v + '%' },
                    title: { display: true, text: 'MFE %', color: COLORS.textMuted, font: { size: 10 } },
                    border: { display: false },
                  },
                },
              } as any}
            />
          </div>
        </div>

        {/* ── Full Statistics Table ── */}
        <div className="an-module span3">
          <div className="an-module-header"><span className="an-chart-title">Full Statistics</span></div>
          <div className="an-stats-table">
            {[
              ['Net PnL', formatCurrency(displayNetPnl), 'Realized PnL', formatCurrency(stats.realizedPnl)],
              ['Win Rate', `${stats.winRate.toFixed(2)}%`, 'Total Trades', String(filtered.length)],
              ['Avg Win', formatCurrency(stats.avgWin), 'Avg Loss', `-${formatCurrency(stats.avgLoss)}`],
              ['Best Trade', formatCurrency(stats.bestTrade), 'Worst Trade', formatCurrency(stats.worstTrade)],
              ['Profit Factor', stats.profitFactor.toFixed(2), 'Expectancy', formatCurrency(stats.expectancy)],
              ['Sharpe', stats.sharpe.toFixed(2), 'Sortino', stats.sortino.toFixed(2)],
              ['Max Drawdown', `-${formatCurrency(stats.maxDrawdown)}`, 'Avg Hold', formatHold(stats.avgHoldMs)],
              ['Win Streak', String(stats.longestWinStreak), 'Loss Streak', String(stats.longestLossStreak)],
              ['Avg MAE', `${(stats.avgMAE * 100).toFixed(2)}%`, 'Avg MFE', `${(stats.avgMFE * 100).toFixed(2)}%`],
              ['Total Fees', `-${formatCurrency(stats.totalFees)}`, 'Longs / Shorts', `${stats.longCount} / ${stats.shortCount}`],
            ].map((row, i) => (
              <div key={i} style={{ display: 'contents' }}>
                <div className="stat-row"><span className="stat-label">{row[0]}</span><span className="font-bold">{row[1]}</span></div>
                <div className="stat-row"><span className="stat-label">{row[2]}</span><span className="font-bold">{row[3]}</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
