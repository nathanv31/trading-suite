import { useState, useMemo, useEffect } from 'react';
import { useTrades } from '../context/TradeContext';
import { dateToKey, formatHold, formatPnl, MONTHS } from '../utils/formatters';
import { getDayNote, saveDayNote, getWeekNote, saveWeekNote } from '../api/client';
import type { Trade, WeekNotes } from '../types';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

export default function CalendarPage() {
  const { trades, loading, error, refreshTrades } = useTrades();
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [selectedWeekKey, setSelectedWeekKey] = useState<string | null>(null);
  const [dayNote, setDayNote] = useState('');
  const [weekNotes, setWeekNotes] = useState<WeekNotes>({ review: '', well: '', improve: '' });

  // Build day map: YYYY-MM-DD -> { trades, pnl }
  const dayMap = useMemo(() => {
    const map: Record<string, { trades: Trade[]; pnl: number }> = {};
    trades.forEach(t => {
      const d = new Date(t.open_time);
      const key = dateToKey(d);
      if (!map[key]) map[key] = { trades: [], pnl: 0 };
      map[key].trades.push(t);
      map[key].pnl += t.pnl - t.fees;
    });
    return map;
  }, [trades]);

  // Build calendar cells
  const calendarWeeks = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const leading = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const prevDays = new Date(calYear, calMonth, 0).getDate();
    const today = new Date(); today.setHours(0,0,0,0);

    type Cell = { day: number; otherMonth: boolean; date: Date | null };
    const cells: Cell[] = [];
    for (let i = leading - 1; i >= 0; i--) cells.push({ day: prevDays - i, otherMonth: true, date: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(calYear, calMonth, d); date.setHours(0,0,0,0);
      cells.push({ day: d, otherMonth: false, date });
    }
    const trailing = cells.length % 7 === 0 ? 0 : 7 - (cells.length % 7);
    for (let d = 1; d <= trailing; d++) cells.push({ day: d, otherMonth: true, date: null });

    const weeks: Cell[][] = [];
    for (let w = 0; w < cells.length / 7; w++) weeks.push(cells.slice(w * 7, w * 7 + 7));
    return weeks;
  }, [calYear, calMonth]);

  // Load day note when selecting
  useEffect(() => {
    if (selectedDayKey) {
      getDayNote(selectedDayKey).then(setDayNote).catch(() => setDayNote(''));
    }
  }, [selectedDayKey]);

  // Load week notes when selecting
  useEffect(() => {
    if (selectedWeekKey) {
      getWeekNote(selectedWeekKey).then(setWeekNotes).catch(() => setWeekNotes({ review: '', well: '', improve: '' }));
    }
  }, [selectedWeekKey]);

  function handleDayNoteChange(val: string) {
    setDayNote(val);
    if (selectedDayKey) saveDayNote(selectedDayKey, val).catch(() => {});
  }

  function handleWeekNoteChange(field: keyof WeekNotes, val: string) {
    const updated = { ...weekNotes, [field]: val };
    setWeekNotes(updated);
    if (selectedWeekKey) saveWeekNote(selectedWeekKey, updated).catch(() => {});
  }

  function shiftMonth(dir: number) {
    let m = calMonth + dir;
    let y = calYear;
    if (m > 11) { m = 0; y++; }
    if (m < 0) { m = 11; y--; }
    setCalMonth(m); setCalYear(y);
  }

  function openDay(key: string) {
    setSelectedDayKey(key);
    setSelectedWeekKey(null);
  }

  function openWeek(weekCells: { date: Date | null }[]) {
    const first = weekCells.find(c => c.date)?.date;
    if (first) {
      setSelectedWeekKey(dateToKey(first));
      setSelectedDayKey(null);
    }
  }

  const selectedDayData = selectedDayKey ? dayMap[selectedDayKey] : null;
  const selectedDate = selectedDayKey ? new Date(selectedDayKey + 'T00:00:00') : null;

  // Week data for selected week
  const selectedWeekData = useMemo(() => {
    if (!selectedWeekKey) return null;
    const week = calendarWeeks.find(w => {
      const first = w.find(c => c.date)?.date;
      return first && dateToKey(first) === selectedWeekKey;
    });
    if (!week) return null;
    const weekTrades: Trade[] = [];
    week.forEach(c => {
      if (!c.date) return;
      const data = dayMap[dateToKey(c.date)];
      if (data) weekTrades.push(...data.trades);
    });
    const pnl = weekTrades.reduce((s, t) => s + t.pnl - t.fees, 0);
    const wins = weekTrades.filter(t => (t.pnl - t.fees) > 0);
    const losses = weekTrades.filter(t => (t.pnl - t.fees) < 0);
    const winRate = weekTrades.length ? (wins.length / weekTrades.length * 100).toFixed(0) : '0';
    const fees = weekTrades.reduce((s, t) => s + t.fees, 0);
    const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
    const rr = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : wins.length > 0 ? '\u221e' : '\u2014';
    return { week, trades: weekTrades, pnl, wins: wins.length, losses: losses.length, winRate, fees, rr };
  }, [selectedWeekKey, calendarWeeks, dayMap]);

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

  const today = new Date(); today.setHours(0,0,0,0);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => shiftMonth(-1)} className="page-btn" style={{ fontSize: 16, padding: '6px 14px' }}>&lsaquo;</button>
          <h2 className="text-xl font-bold" style={{ minWidth: 160, textAlign: 'center' }}>{MONTH_NAMES[calMonth]} {calYear}</h2>
          <button onClick={() => shiftMonth(1)} className="page-btn" style={{ fontSize: 16, padding: '6px 14px' }}>&rsaquo;</button>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => { setCalYear(now.getFullYear()); setCalMonth(now.getMonth()); }} className="page-btn">Today</button>
        </div>
      </div>

      <div className="flex gap-4" style={{ alignItems: 'flex-start' }}>
        {/* Calendar Grid */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '32px repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
            <div />
            {DAY_NAMES.map(d => <div key={d} className="cal-header-cell">{d}</div>)}
          </div>

          {/* Week rows */}
          {calendarWeeks.map((week, wi) => {
            const weekTrades: Trade[] = [];
            week.forEach(c => { if (c.date) { const d = dayMap[dateToKey(c.date)]; if (d) weekTrades.push(...d.trades); }});
            const weekPnl = weekTrades.reduce((s, t) => s + t.pnl - t.fees, 0);
            const hasWeekTrades = weekTrades.length > 0;
            const weekFirst = week.find(c => c.date)?.date;
            const weekKey = weekFirst ? dateToKey(weekFirst) : `w${wi}`;

            return (
              <div key={wi} className="cal-week-row">
                {/* Week tab */}
                <div
                  className={`cal-week-tab ${selectedWeekKey === weekKey ? 'active' : ''}`}
                  onClick={() => openWeek(week)}
                >
                  {hasWeekTrades ? (
                    <>
                      <div className="cal-week-tab-dot" style={{ width: 5, height: 5, borderRadius: '50%', background: weekPnl >= 0 ? 'var(--profit-color)' : 'var(--loss-color)' }} />
                      <div style={{ fontSize: 9, fontWeight: 700, writingMode: 'vertical-rl', transform: 'rotate(180deg)', color: weekPnl >= 0 ? 'var(--profit-color)' : 'var(--loss-color)' }}>
                        {weekPnl >= 0 ? '+' : '-'}${Math.abs(weekPnl).toFixed(0)}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 9, color: 'var(--text-secondary)', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>&mdash;</div>
                  )}
                </div>

                {/* Day cells */}
                {week.map((c, ci) => {
                  if (c.otherMonth) {
                    return (
                      <div key={ci} className="cal-cell other-month">
                        <div className="cal-day-num">{c.day}</div>
                      </div>
                    );
                  }
                  const key = dateToKey(c.date!);
                  const data = dayMap[key];
                  const isToday = c.date!.getTime() === today.getTime();
                  const isActive = selectedDayKey === key;
                  return (
                    <div
                      key={ci}
                      className={`cal-cell${isToday ? ' today' : ''}${isActive ? ' active-day' : ''}`}
                      onClick={() => openDay(key)}
                    >
                      <div className="cal-day-num">{c.day}</div>
                      {data && (
                        <>
                          <div className={`cal-day-pnl ${data.pnl >= 0 ? 'profit' : 'loss'}`}>
                            {data.pnl >= 0 ? '+' : ''}${Math.abs(data.pnl).toFixed(2)}
                          </div>
                          <div className="cal-day-trades">{data.trades.length} trade{data.trades.length !== 1 ? 's' : ''}</div>
                          <div className={`cal-cell-bar ${data.pnl >= 0 ? 'profit' : 'loss'}`} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, borderRadius: '0 0 7px 7px' }} />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Day Sidebar */}
        {selectedDayKey && selectedDate && (
          <div className="cal-sidebar" style={{ width: 420, flexShrink: 0, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 20 }}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-sm">{selectedDate.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</h3>
              <button className="toggle-btn" onClick={() => setSelectedDayKey(null)}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Summary */}
            {selectedDayData && selectedDayData.trades.length > 0 ? (
              <div className={`cal-day-summary mb-4 ${selectedDayData.pnl >= 0 ? 'profit' : 'loss'}`}>
                <div className="secondary-text text-xs mb-1">{selectedDayData.pnl >= 0 ? 'Total Win' : 'Total Loss'}</div>
                <div className={`text-2xl font-bold ${selectedDayData.pnl >= 0 ? 'profit-text' : 'loss-text'}`}>{formatPnl(selectedDayData.pnl)}</div>
                <div className="secondary-text text-xs mt-1">{selectedDayData.trades.length} Trade{selectedDayData.trades.length !== 1 ? 's' : ''}</div>
              </div>
            ) : (
              <div className="cal-day-summary mb-4 flat"><div className="secondary-text text-xs">No trades this day</div></div>
            )}
            {/* Day Notes */}
            <div className="secondary-text mb-2" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>Daily Notes</div>
            <textarea className="note-area mb-4" placeholder="Add notes about your trading day..." value={dayNote} onChange={e => handleDayNoteChange(e.target.value)} style={{ minHeight: 200 }} />
            {/* Trades list */}
            <div className="secondary-text mb-2" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>Trades</div>
            {selectedDayData?.trades.map(t => {
              const isWin = t.pnl >= 0;
              return (
                <div key={t.id} className="cal-trade-row">
                  <div className="cal-trade-bar" style={{ width: 3, height: 32, borderRadius: 2, background: isWin ? 'var(--profit-color)' : 'var(--loss-color)' }} />
                  <div style={{ flex: 1 }}>
                    <div className="font-bold" style={{ fontSize: 12 }}>{t.coin}</div>
                    <div className="secondary-text" style={{ fontSize: 10 }}>{t.side === 'B' ? '\u2197 Long' : '\u2198 Short'} &middot; {formatHold(t.hold_ms)}</div>
                  </div>
                  <div className={`${isWin ? 'profit-text' : 'loss-text'} font-bold`} style={{ fontSize: 12 }}>{formatPnl(t.pnl)}</div>
                </div>
              );
            })}
            {(!selectedDayData || selectedDayData.trades.length === 0) && <div className="secondary-text text-xs">No trades</div>}
          </div>
        )}

        {/* Week Sidebar */}
        {selectedWeekData && selectedWeekKey && (
          <div className="cal-sidebar" style={{ width: 420, flexShrink: 0, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 20 }}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-sm accent-text">
                Week of {(() => { const cells = selectedWeekData.week.filter(c => c.date); const f = cells[0]?.date; const l = cells[cells.length-1]?.date; return f && l ? `${f.getDate()} ${MONTHS[f.getMonth()]} \u2013 ${l.getDate()} ${MONTHS[l.getMonth()]}` : 'Weekly Review'; })()}
              </h3>
              <button className="toggle-btn" onClick={() => setSelectedWeekKey(null)}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Week Summary */}
            <div className={`cal-day-summary mb-3 ${selectedWeekData.pnl >= 0 ? 'profit' : 'loss'}`}>
              <div className="secondary-text text-xs mb-1">Week P&amp;L</div>
              <div className={`text-2xl font-bold ${selectedWeekData.pnl >= 0 ? 'profit-text' : 'loss-text'}`}>{formatPnl(selectedWeekData.pnl)}</div>
              <div className="secondary-text text-xs mt-1">{selectedWeekData.trades.length} trades &middot; {selectedWeekData.wins}W / {selectedWeekData.losses}L</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div className="detail-card" style={{ padding: 10, textAlign: 'center' }}>
                <div className="secondary-text" style={{ fontSize: 9, textTransform: 'uppercase', marginBottom: 4 }}>Win Rate</div>
                <div className={`font-bold text-sm ${parseInt(selectedWeekData.winRate) >= 50 ? 'profit-text' : 'loss-text'}`}>{selectedWeekData.winRate}%</div>
              </div>
              <div className="detail-card" style={{ padding: 10, textAlign: 'center' }}>
                <div className="secondary-text" style={{ fontSize: 9, textTransform: 'uppercase', marginBottom: 4 }}>Avg R:R</div>
                <div className="font-bold text-sm accent-text">{selectedWeekData.rr}</div>
              </div>
              <div className="detail-card" style={{ padding: 10, textAlign: 'center' }}>
                <div className="secondary-text" style={{ fontSize: 9, textTransform: 'uppercase', marginBottom: 4 }}>Fees</div>
                <div className="font-bold text-sm loss-text">-${selectedWeekData.fees.toFixed(2)}</div>
              </div>
            </div>
            {/* Day Breakdown */}
            <div className="secondary-text mb-2" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>Day Breakdown</div>
            {selectedWeekData.week.map((c, i) => {
              if (!c.date) return null;
              const key = dateToKey(c.date);
              const data = dayMap[key];
              const pnl = data ? data.pnl : null;
              const cnt = data ? data.trades.length : 0;
              return (
                <div key={i} className="cal-trade-row" style={{ cursor: cnt > 0 ? 'pointer' : 'default' }} onClick={() => cnt > 0 && openDay(key)}>
                  <div className="cal-trade-bar" style={{ width: 3, height: 32, borderRadius: 2, background: pnl === null ? 'var(--border-color)' : pnl >= 0 ? 'var(--profit-color)' : 'var(--loss-color)' }} />
                  <div style={{ flex: 1 }}>
                    <div className="font-bold" style={{ fontSize: 12 }}>{DAY_NAMES[i]} {c.day}</div>
                    <div className="secondary-text" style={{ fontSize: 10 }}>{cnt > 0 ? `${cnt} trade${cnt !== 1 ? 's' : ''}` : 'No trades'}</div>
                  </div>
                  <div className={`${pnl === null ? 'secondary-text' : pnl >= 0 ? 'profit-text' : 'loss-text'} font-bold`} style={{ fontSize: 12 }}>
                    {pnl === null ? '\u2014' : formatPnl(pnl)}
                  </div>
                </div>
              );
            })}
            {/* Weekly Review Notes */}
            <div className="secondary-text mb-2 mt-4" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>Weekly Review</div>
            <textarea className="note-area mb-3" placeholder="Weekly review \u2014 what went well, what to improve..." value={weekNotes.review} onChange={e => handleWeekNoteChange('review', e.target.value)} style={{ minHeight: 150 }} />
            <div className="detail-grid" style={{ marginTop: 0 }}>
              <div className="detail-card">
                <h4>What Went Well</h4>
                <textarea className="note-area" placeholder="Wins, good decisions..." value={weekNotes.well} onChange={e => handleWeekNoteChange('well', e.target.value)} style={{ minHeight: 80, border: 'none', padding: 0, background: 'transparent' }} />
              </div>
              <div className="detail-card">
                <h4>What to Improve</h4>
                <textarea className="note-area" placeholder="Mistakes, patterns to break..." value={weekNotes.improve} onChange={e => handleWeekNoteChange('improve', e.target.value)} style={{ minHeight: 80, border: 'none', padding: 0, background: 'transparent' }} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
