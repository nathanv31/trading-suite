import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, TimeScale, ArcElement, Filler, Tooltip } from 'chart.js';
import 'chartjs-adapter-luxon';
import { Line, Doughnut } from 'react-chartjs-2';
import { useTrades } from '../context/TradeContext';
import { useWallet } from '../context/WalletContext';
import { formatCurrency, formatPnl, formatVolume, formatDate, formatTime, formatPrice } from '../utils/formatters';
import { getPnlSummary } from '../api/client';
import {
  COLORS, prepareEquityChartData, perTradeScaleOverrides,
  lineChartOptions, lineDatasetDefaults, createGradient, tooltipConfig,
  type AggregationLevel,
} from '../utils/chartConfig';
import type { PnlSummary } from '../types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, TimeScale, ArcElement, Filler, Tooltip);

const AGG_OPTIONS: { value: AggregationLevel; label: string }[] = [
  { value: 'trade', label: 'Per Trade' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

export default function HomePage() {
  const { trades, loading, error, refreshTrades } = useTrades();
  const { wallet } = useWallet();
  const [pnlSummary, setPnlSummary] = useState<PnlSummary | null>(null);
  const [aggLevel, setAggLevel] = useState<AggregationLevel>('daily');
  const chartRef = useRef<ChartJS<'line'> | null>(null);

  useEffect(() => {
    if (wallet && trades.length > 0) {
      getPnlSummary(wallet).then(setPnlSummary).catch(() => {});
    }
  }, [wallet, trades]);

  const metrics = useMemo(() => {
    if (!trades.length) return null;
    const wins = trades.filter(t => (t.pnl - t.fees) > 0);
    const losses = trades.filter(t => (t.pnl - t.fees) < 0);
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const totalFees = trades.reduce((s, t) => s + t.fees, 0);
    const netPnl = totalPnl - totalFees;
    const totalVolume = trades.reduce((s, t) => s + t.entry_px * t.size, 0);
    const longTrades = trades.filter(t => t.side === 'B').length;
    const shortTrades = trades.filter(t => t.side === 'A').length;

    return {
      netPnl,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length > 0 ? (wins.length / trades.length * 100) : 0,
      tradeCount: trades.length,
      totalVolume,
      avgVolume: trades.length > 0 ? totalVolume / trades.length : 0,
      longRatio: trades.length > 0 ? (longTrades / trades.length * 100).toFixed(1) : '0',
      shortRatio: trades.length > 0 ? (shortTrades / trades.length * 100).toFixed(1) : '0',
    };
  }, [trades]);

  const equityChart = useMemo(() => prepareEquityChartData(trades, aggLevel), [trades, aggLevel]);
  const equityData = equityChart.points;

  const finalPnl = equityData.length > 0 ? equityData[equityData.length - 1].y : 0;
  const isProfit = finalPnl >= 0;
  const lineColor = isProfit ? COLORS.profit : COLORS.loss;
  const lineColorRgb = isProfit ? COLORS.profitRgb : COLORS.lossRgb;

  const getGradient = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return `rgba(${lineColorRgb},0.1)`;
    const { ctx, chartArea } = chart;
    if (!chartArea) return `rgba(${lineColorRgb},0.1)`;
    return createGradient(ctx, chartArea, lineColorRgb, 0.28, 0);
  }, [lineColorRgb]);

  const pnlChartData = useMemo(() => ({
    datasets: [{
      data: equityData as any,
      ...lineDatasetDefaults(lineColor, lineColorRgb, equityChart.isPerTrade),
      backgroundColor: getGradient(),
    }],
  }), [equityData, lineColor, lineColorRgb, equityChart.isPerTrade, getGradient]);

  const pnlChartOptions = useMemo(() => lineChartOptions({
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
              const dateStr = date ? date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
              return `Trade #${idx + 1} \u2014 ${dateStr}`;
            }
            const d = new Date(items[0].parsed.x ?? 0);
            if (aggLevel === 'monthly') return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
            if (aggLevel === 'weekly') return `Week of ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
            return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
          },
          label: (item) => `  Cumulative P&L: ${formatCurrency(item.parsed.y ?? 0)}`,
        },
      },
    },
  }), [aggLevel, equityChart]);

  const recentTrades = useMemo(() => {
    return [...trades].sort((a, b) => b.open_time - a.open_time).slice(0, 3);
  }, [trades]);

  // Update gradient when chart resizes
  useEffect(() => {
    const chart = chartRef.current;
    if (chart && chart.data.datasets[0]) {
      const { ctx, chartArea } = chart;
      if (chartArea) {
        chart.data.datasets[0].backgroundColor = createGradient(ctx, chartArea, lineColorRgb, 0.28, 0);
        chart.update('none');
      }
    }
  }, [equityData, lineColorRgb]);

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: 200 }}>
        <div className="spinner" />
      </div>
    );
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

  if (!metrics) {
    return (
      <div className="p-6">
        <div className="metric-card" style={{ padding: 32, textAlign: 'center' }}>
          <div className="secondary-text mb-4" style={{ fontSize: 14 }}>No trades found for this wallet</div>
          <button className="btn-primary" onClick={refreshTrades} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh Trades'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Top Metrics */}
      <div className="grid grid-cols-4 gap-6 mb-6">
        {/* Net PnL with breakdown */}
        <div className="metric-card">
          <div className="secondary-text text-sm mb-2">Net PnL</div>
          <div className={`text-3xl font-bold ${(pnlSummary?.net_pnl ?? metrics.netPnl) >= 0 ? 'profit-text' : 'loss-text'}`}>
            {formatCurrency(pnlSummary?.net_pnl ?? metrics.netPnl)}
          </div>
          {pnlSummary && (
            <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.8 }}>
              <div className="flex justify-between">
                <span className="secondary-text">Trading PnL</span>
                <span>{formatPnl(pnlSummary.gross_pnl)}</span>
              </div>
              <div className="flex justify-between">
                <span className="secondary-text">Fees</span>
                <span className="loss-text">-${pnlSummary.total_fees.toFixed(2)}</span>
              </div>
              {pnlSummary.total_funding !== null && (
                <div className="flex justify-between">
                  <span className="secondary-text">Funding</span>
                  <span className={pnlSummary.total_funding >= 0 ? 'profit-text' : 'loss-text'}>
                    {formatPnl(pnlSummary.total_funding)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Win Rate Donut */}
        <div className="metric-card">
          <div className="secondary-text text-sm mb-2">Total Win Rate</div>
          <div style={{ maxWidth: 180, margin: '0 auto' }}>
            <Doughnut
              data={{
                datasets: [{
                  data: [metrics.wins, metrics.losses],
                  backgroundColor: [
                    `rgba(${COLORS.profitRgb},0.8)`,
                    `rgba(${COLORS.lossRgb},0.8)`,
                  ],
                  hoverBackgroundColor: [COLORS.profit, COLORS.loss],
                  borderWidth: 0,
                  spacing: 2,
                }],
              }}
              options={{
                cutout: '72%',
                animation: { animateRotate: true, animateScale: true },
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    ...tooltipConfig,
                    callbacks: {
                      label: (item) => {
                        const label = item.dataIndex === 0 ? 'Wins' : 'Losses';
                        return `  ${label}: ${item.raw}`;
                      },
                    },
                  },
                },
              }}
            />
          </div>
          <div className="text-center mt-2">
            <div className="profit-text">{metrics.wins} Wins</div>
            <div className="loss-text">{metrics.losses} Losses</div>
          </div>
        </div>

        {/* Trade Count */}
        <div className="metric-card">
          <div className="secondary-text text-sm mb-2">Total Trade Count</div>
          <div className="text-3xl font-bold">{metrics.tradeCount}</div>
          <div className="secondary-text text-sm mt-2">
            Total volume {formatVolume(metrics.totalVolume)} with avg of {formatCurrency(metrics.avgVolume, 0)}/trade
          </div>
        </div>

        {/* Long/Short Ratio */}
        <div className="metric-card">
          <div className="secondary-text text-sm mb-2 flex justify-between">
            <span>Long Ratio</span>
            <span>Short Ratio</span>
          </div>
          <div className="flex gap-2 mb-2">
            <div className="h-8 rounded" style={{ background: 'var(--profit-color)', width: `${metrics.longRatio}%` }} />
            <div className="h-8 rounded" style={{ background: 'var(--loss-color)', width: `${metrics.shortRatio}%` }} />
          </div>
          <div className="flex justify-between text-sm">
            <span className="profit-text">{metrics.longRatio}%</span>
            <span className="loss-text">{metrics.shortRatio}%</span>
          </div>
        </div>
      </div>

      {/* PnL Chart */}
      <div className="metric-card mb-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold">Lifetime PNL</h3>
          <div className="chart-agg-toggle">
            {AGG_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`chart-agg-btn${aggLevel === opt.value ? ' active' : ''}`}
                onClick={() => setAggLevel(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className={`text-2xl font-bold mb-4 ${(pnlSummary?.net_pnl ?? metrics.netPnl) >= 0 ? 'profit-text' : 'loss-text'}`}>
          {formatCurrency(pnlSummary?.net_pnl ?? metrics.netPnl)}
        </div>
        <div style={{ height: 300 }}>
          <Line
            ref={chartRef}
            data={pnlChartData}
            options={pnlChartOptions}
          />
        </div>
      </div>

      {/* Recent Trades */}
      <div className="metric-card">
        <h3 className="text-xl font-bold mb-4">Last 3 Trades</h3>
        {recentTrades.map(trade => {
          const netPnl = trade.pnl - trade.fees;
          const isWin = netPnl > 0;
          return (
            <div key={trade.id} className="trade-row">
              <div className={`trade-bar ${isWin ? 'win' : 'loss'}`} />
              <div style={{ flex: 1 }}>
                <div className="flex items-center gap-3 mb-2">
                  <div className="coin-badge">{trade.coin.charAt(0)}</div>
                  <div className="font-bold">{trade.coin}</div>
                  <div className={`text-sm ${trade.side === 'B' ? 'profit-text' : 'loss-text'}`}>
                    {trade.side === 'B' ? '\u2197' : '\u2198'} {formatCurrency(trade.entry_px * trade.size, 0)}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="secondary-text">Time</div>
                    <div>{formatDate(trade.open_time)} {formatTime(trade.open_time)}</div>
                  </div>
                  <div>
                    <div className="secondary-text">Entry</div>
                    <div>{formatPrice(trade.entry_px)}</div>
                  </div>
                  <div>
                    <div className="secondary-text">Size</div>
                    <div>{trade.size.toFixed(4)}</div>
                  </div>
                  <div>
                    <div className="secondary-text">PnL</div>
                    <div className={`${isWin ? 'profit-text' : 'loss-text'} font-bold`}>
                      {formatPnl(netPnl)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
