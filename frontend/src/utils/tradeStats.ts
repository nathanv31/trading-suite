import type { Trade } from '../types';
import { formatHold } from './formatters';

export interface AnalyticsStats {
  netPnl: number;
  realizedPnl: number;
  totalFees: number;
  winRate: number;
  wins: number;
  losses: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  avgRR: number;
  expectancy: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  avgHoldMs: number;
  longCount: number;
  shortCount: number;
  longPnl: number;
  shortPnl: number;
  bestTrade: number;
  worstTrade: number;
  longestWinStreak: number;
  longestLossStreak: number;
  avgMAE: number;
  avgMFE: number;
}

export function computeStats(trades: Trade[]): AnalyticsStats {
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const totalFees = trades.reduce((s, t) => s + t.fees, 0);
  const netPnl = totalPnl - totalFees;
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
  const totalWinPnl = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLossPnl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = totalLossPnl > 0 ? totalWinPnl / totalLossPnl : 0;
  const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;
  const expectancy = (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss;

  // Sharpe & Sortino (daily returns)
  const dailyMap: Record<string, number> = {};
  trades.forEach(t => {
    const k = new Date(t.open_time).toISOString().slice(0, 10);
    dailyMap[k] = (dailyMap[k] || 0) + t.pnl;
  });
  const dailyRets = Object.values(dailyMap);
  const meanRet = dailyRets.length ? dailyRets.reduce((s, v) => s + v, 0) / dailyRets.length : 0;
  const stdRet = Math.sqrt(dailyRets.reduce((s, v) => s + (v - meanRet) ** 2, 0) / dailyRets.length) || 1;
  const sharpe = (meanRet / stdRet) * Math.sqrt(252);
  const downRets = dailyRets.filter(v => v < 0);
  const downStd = Math.sqrt(downRets.reduce((s, v) => s + v ** 2, 0) / dailyRets.length) || 1;
  const sortino = (meanRet / downStd) * Math.sqrt(252);

  // Max drawdown
  const sorted = [...trades].sort((a, b) => a.open_time - b.open_time);
  let peak = 0, maxDD = 0, runPnl = 0;
  sorted.forEach(t => {
    runPnl += t.pnl - t.fees;
    if (runPnl > peak) peak = runPnl;
    const dd = peak - runPnl;
    if (dd > maxDD) maxDD = dd;
  });

  // Hold time
  const holds = trades.filter(t => t.hold_ms && t.hold_ms > 0).map(t => t.hold_ms!);
  const avgHoldMs = holds.length ? holds.reduce((s, v) => s + v, 0) / holds.length : 0;

  // Long/Short
  const longCount = trades.filter(t => t.side === 'B').length;
  const shortCount = trades.filter(t => t.side === 'A').length;
  const longPnl = trades.filter(t => t.side === 'B').reduce((s, t) => s + t.pnl, 0);
  const shortPnl = trades.filter(t => t.side === 'A').reduce((s, t) => s + t.pnl, 0);

  // Streaks
  let lws = 0, lls = 0, cw = 0, cl = 0;
  sorted.forEach(t => {
    if (t.pnl > 0) { cw++; cl = 0; if (cw > lws) lws = cw; }
    else { cl++; cw = 0; if (cl > lls) lls = cl; }
  });

  // MAE/MFE
  const maeTrades = trades.filter(t => t.mae != null && t.mae > 0);
  const mfeTrades = trades.filter(t => t.mfe != null && t.mfe > 0);
  const avgMAE = maeTrades.length ? maeTrades.reduce((s, t) => s + t.mae!, 0) / maeTrades.length : 0;
  const avgMFE = mfeTrades.length ? mfeTrades.reduce((s, t) => s + t.mfe!, 0) / mfeTrades.length : 0;

  return {
    netPnl, realizedPnl: totalPnl, totalFees, winRate, wins: wins.length, losses: losses.length,
    avgWin, avgLoss, profitFactor, avgRR, expectancy, sharpe, sortino, maxDrawdown: maxDD,
    avgHoldMs, longCount, shortCount, longPnl, shortPnl,
    bestTrade: wins.length ? Math.max(...wins.map(t => t.pnl)) : 0,
    worstTrade: losses.length ? Math.min(...losses.map(t => t.pnl)) : 0,
    longestWinStreak: lws, longestLossStreak: lls, avgMAE, avgMFE,
  };
}
