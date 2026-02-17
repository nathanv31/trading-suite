import { useState, useMemo, useEffect } from 'react';
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
import { getPnlSummary } from '../api/client';
import TagFilter from '../components/TagFilter';
import type { PnlSummary } from '../types';


ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, TimeScale, Filler, Tooltip, Legend);

const CHART_GRID = { color: '#3e3e42' };
const CHART_TICKS = { color: '#858585', font: { family: 'JetBrains Mono', size: 10 } };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function AnalyticsPage() {
  const { trades, loading, error, refreshTrades, tagMap, allTags } = useTrades();
  const { wallet } = useWallet();
  const [sideFilter, setSideFilter] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [coinFilter, setCoinFilter] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [tagLogic, setTagLogic] = useState<'any' | 'all'>('any');
  const [pnlSummary, setPnlSummary] = useState<PnlSummary | null>(null);

  const isUnfiltered = !sideFilter && !resultFilter && !coinFilter && selectedTags.size === 0;

  useEffect(() => {
    if (wallet && trades.length > 0) {
      getPnlSummary(wallet).then(setPnlSummary).catch(() => {});
    }
  }, [wallet, trades]);

  const coins = useMemo(() => [...new Set(trades.map(t => t.coin))].sort(), [trades]);

  const filtered = useMemo(() => {
    let list = [...trades];
    if (sideFilter) list = list.filter(t => t.side === sideFilter);
    if (resultFilter === 'win') list = list.filter(t => (t.pnl - t.fees) > 0);
    if (resultFilter === 'loss') list = list.filter(t => (t.pnl - t.fees) < 0);
    if (coinFilter) list = list.filter(t => t.coin === coinFilter);

    // Tag filter
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
  }, [trades, sideFilter, resultFilter, coinFilter, selectedTags, tagLogic, tagMap]);

  const stats = useMemo(() => filtered.length > 0 ? computeStats(filtered) : null, [filtered]);

  // Chart data
  const sorted = useMemo(() => [...filtered].sort((a, b) => a.open_time - b.open_time), [filtered]);

  // Equity curve
  const equityData = useMemo(() => {
    let cum = 0;
    return sorted.map(t => { cum += t.pnl - t.fees; return { x: new Date(t.open_time), y: parseFloat(cum.toFixed(2)) }; });
  }, [sorted]);

  // Drawdown
  const drawdownData = useMemo(() => {
    let pk = 0;
    return equityData.map(p => { if (p.y > pk) pk = p.y; return { x: p.x, y: pk > 0 ? parseFloat(((p.y - pk) / pk * 100).toFixed(2)) : 0 }; });
  }, [equityData]);

  // Day of week
  const dowData = useMemo(() => {
    const pnl = [0, 0, 0, 0, 0, 0, 0];
    filtered.forEach(t => pnl[new Date(t.open_time).getDay()] += t.pnl - t.fees);
    return { labels: DOW_ORDER.map(i => DAYS[i]), data: DOW_ORDER.map(i => parseFloat(pnl[i].toFixed(2))) };
  }, [filtered]);

  // Time of day
  const todData = useMemo(() => {
    const labels = ['00-04', '04-08', '08-12', '12-16', '16-20', '20-24'];
    const pnl = [0, 0, 0, 0, 0, 0];
    filtered.forEach(t => { const h = new Date(t.open_time).getHours(); pnl[Math.floor(h / 4)] += t.pnl - t.fees; });
    return { labels, data: pnl.map(v => parseFloat(v.toFixed(2))) };
  }, [filtered]);

  // Hold time buckets
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

  // Coin PnL
  const coinData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(t => { map[t.coin] = (map[t.coin] || 0) + t.pnl - t.fees; });
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    return { labels: entries.map(e => e[0]), data: entries.map(e => parseFloat(e[1].toFixed(2))) };
  }, [filtered]);

  // Streak
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

  const barColors = (data: number[]) => data.map(v => v >= 0 ? 'rgba(78,201,176,0.7)' : 'rgba(244,135,113,0.7)');
  const barBorders = (data: number[]) => data.map(v => v >= 0 ? '#4ec9b0' : '#f48771');

  const barOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { x: { grid: CHART_GRID, ticks: CHART_TICKS }, y: { grid: CHART_GRID, ticks: CHART_TICKS } },
  };

  const displayNetPnl = (isUnfiltered && pnlSummary) ? pnlSummary.net_pnl : stats.netPnl;
  const fundingSub = (isUnfiltered && pnlSummary?.total_funding !== null && pnlSummary?.total_funding !== undefined)
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
  ];

  const cumColor = (equityData[equityData.length - 1]?.y ?? 0) >= 0 ? '#4ec9b0' : '#f48771';

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
        {/* Equity Curve */}
        <div className="an-module span2">
          <div className="an-module-header"><span className="an-chart-title">Cumulative P&L</span></div>
          <div style={{ height: 200 }}>
            <Line data={{ datasets: [{ data: equityData, borderColor: cumColor, backgroundColor: cumColor === '#4ec9b0' ? 'rgba(78,201,176,0.08)' : 'rgba(244,135,113,0.08)', fill: true, tension: 0.3, borderWidth: 2, pointRadius: 0 }] }}
              options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { type: 'time', grid: CHART_GRID, ticks: CHART_TICKS }, y: { grid: CHART_GRID, ticks: CHART_TICKS } } }} />
          </div>
        </div>

        {/* Drawdown */}
        <div className="an-module">
          <div className="an-module-header"><span className="an-chart-title">Drawdown</span></div>
          <div style={{ height: 200 }}>
            <Line data={{ datasets: [{ data: drawdownData, borderColor: '#f48771', backgroundColor: 'rgba(244,135,113,0.15)', fill: true, tension: 0.3, borderWidth: 1.5, pointRadius: 0 }] }}
              options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { type: 'time', grid: CHART_GRID, ticks: CHART_TICKS }, y: { grid: CHART_GRID, ticks: { ...CHART_TICKS, callback: (v: any) => v + '%' } } } }} />
          </div>
        </div>

        {/* Day of Week */}
        <div className="an-module">
          <div className="an-module-header"><span className="an-chart-title">P&L by Day of Week</span></div>
          <div style={{ height: 200 }}>
            <Bar data={{ labels: dowData.labels, datasets: [{ data: dowData.data, backgroundColor: barColors(dowData.data), borderColor: barBorders(dowData.data), borderWidth: 1, borderRadius: 4 }] }}
              options={barOpts as any} />
          </div>
        </div>

        {/* Time of Day */}
        <div className="an-module">
          <div className="an-module-header"><span className="an-chart-title">P&L by Time of Day</span></div>
          <div style={{ height: 200 }}>
            <Bar data={{ labels: todData.labels, datasets: [{ data: todData.data, backgroundColor: barColors(todData.data), borderColor: barBorders(todData.data), borderWidth: 1, borderRadius: 4 }] }}
              options={barOpts as any} />
          </div>
        </div>

        {/* Hold Time */}
        <div className="an-module">
          <div className="an-module-header"><span className="an-chart-title">P&L by Hold Time</span></div>
          <div style={{ height: 200 }}>
            <Bar data={{ labels: holdData.labels, datasets: [{ data: holdData.data, backgroundColor: barColors(holdData.data), borderColor: barBorders(holdData.data), borderWidth: 1, borderRadius: 4 }] }}
              options={barOpts as any} />
          </div>
        </div>

        {/* Coin PnL */}
        <div className="an-module span2">
          <div className="an-module-header"><span className="an-chart-title">P&L by Asset</span></div>
          <div style={{ height: 200 }}>
            <Bar data={{ labels: coinData.labels, datasets: [{ data: coinData.data, backgroundColor: barColors(coinData.data), borderColor: barBorders(coinData.data), borderWidth: 1, borderRadius: 4 }] }}
              options={barOpts as any} />
          </div>
        </div>

        {/* Long vs Short */}
        <div className="an-module">
          <div className="an-module-header"><span className="an-chart-title">Long vs Short</span></div>
          <div style={{ height: 200 }}>
            <Doughnut data={{ labels: [`Long (${stats.longCount})`, `Short (${stats.shortCount})`], datasets: [{ data: [stats.longCount, stats.shortCount], backgroundColor: ['rgba(78,201,176,0.75)', 'rgba(244,135,113,0.75)'], borderWidth: 0 }] }}
              options={{ responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { display: true, position: 'bottom', labels: { color: '#858585', font: { family: 'JetBrains Mono', size: 10 }, padding: 8 } } } }} />
          </div>
        </div>

        {/* Distribution */}
        <div className="an-module">
          <div className="an-module-header"><span className="an-chart-title">P&L Distribution</span></div>
          <div style={{ height: 200 }}>
            {(() => {
              const pnls = filtered.map(t => t.pnl - t.fees);
              const minP = Math.min(...pnls), maxP = Math.max(...pnls);
              const bc = 12, bs = (maxP - minP) / bc || 1;
              const db = Array(bc).fill(0);
              pnls.forEach(p => { const i = Math.min(Math.floor((p - minP) / bs), bc - 1); db[i]++; });
              const dl = db.map((_, i) => `$${(minP + i * bs).toFixed(0)}`);
              const dc = dl.map(l => parseFloat(l.slice(1)) >= 0 ? 'rgba(78,201,176,0.7)' : 'rgba(244,135,113,0.7)');
              return <Bar data={{ labels: dl, datasets: [{ data: db, backgroundColor: dc, borderWidth: 0, borderRadius: 3 }] }} options={barOpts as any} />;
            })()}
          </div>
        </div>

        {/* Streak */}
        <div className="an-module">
          <div className="an-module-header"><span className="an-chart-title">Win / Loss Streak</span></div>
          <div style={{ height: 200 }}>
            <Bar data={{ datasets: [{ data: streakData, backgroundColor: streakData.map(d => d.y > 0 ? 'rgba(78,201,176,0.7)' : 'rgba(244,135,113,0.7)'), borderWidth: 0, borderRadius: 2 }] }}
              options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { type: 'time', grid: CHART_GRID, ticks: CHART_TICKS }, y: { grid: CHART_GRID, ticks: CHART_TICKS } } } as any} />
          </div>
        </div>

        {/* MAE vs MFE */}
        <div className="an-module">
          <div className="an-module-header"><span className="an-chart-title">MAE vs MFE</span></div>
          <div style={{ height: 200 }}>
            <Scatter data={{
              datasets: [
                { label: 'Win', data: filtered.filter(t => (t.pnl - t.fees) > 0).map(t => ({ x: (t.mae || 0) * 100, y: (t.mfe || 0) * 100 })), backgroundColor: 'rgba(78,201,176,0.6)', pointRadius: 4 },
                { label: 'Loss', data: filtered.filter(t => (t.pnl - t.fees) < 0).map(t => ({ x: (t.mae || 0) * 100, y: (t.mfe || 0) * 100 })), backgroundColor: 'rgba(244,135,113,0.6)', pointRadius: 4 },
              ]
            }} options={{
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { display: true, position: 'bottom', labels: { color: '#858585', font: { family: 'JetBrains Mono', size: 10 }, padding: 8 } } },
              scales: {
                x: { grid: CHART_GRID, ticks: { ...CHART_TICKS, callback: (v: any) => v + '%' }, title: { display: true, text: 'MAE %', color: '#858585', font: { size: 10 } } },
                y: { grid: CHART_GRID, ticks: { ...CHART_TICKS, callback: (v: any) => v + '%' }, title: { display: true, text: 'MFE %', color: '#858585', font: { size: 10 } } },
              },
            } as any} />
          </div>
        </div>

        {/* Full Statistics Table */}
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
