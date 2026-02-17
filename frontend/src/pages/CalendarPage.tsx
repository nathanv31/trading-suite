import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTrades } from '../context/TradeContext';
import { dateToKey, formatHold, formatPnl, MONTHS } from '../utils/formatters';
import { getDayNote, saveDayNote, getWeekNote, saveWeekNote } from '../api/client';
import type { Trade, WeekNotes } from '../types';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

export default function CalendarPage() {
  const navigate = useNavigate();
  const { trades, loading, error, refreshTrades } = useTrades();
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [selectedWeekKey, setSelectedWeekKey] = useState<string | null>(null);
  const [dayNote, setDayNote] = useState('');
  const [weekNotes, setWeekNotes] = useState<WeekNotes>({ review: '', well: '', improve: '' });

  // Build day map: YYYY-MM-DD -> { trades, pnl }
  // Allocate each trade to the date it was fully closed (fall back to open_time if still open)
  const dayMap = useMemo(() => {
    const map: Record<string, { trades: Trade[]; pnl: number }> = {};
    trades.forEach(t => {
      const d = new Date(t.close_time ?? t.open_time);
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

  useEffect(() => {
    if (selectedDayKey) {
      getDayNote(selectedDayKey).then(setDayNote).catch(() => setDayNote(''));
    }
  }, [selectedDayKey]);

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

  function goToday() {
    setCalYear(now.getFullYear());
    setCalMonth(now.getMonth());
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
    const avgWin = wins.length ? wins.reduce((s, t) => s + (t.pnl - t.fees), 0) / wins.length : 0;
    const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + (t.pnl - t.fees), 0) / losses.length) : 0;
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

  // Year range for selector
  const years = [];
  for (let y = 2022; y <= now.getFullYear() + 1; y++) years.push(y);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="cal-header">
        <div className="cal-header-left">
          <button onClick={() => shiftMonth(-1)} className="cal-nav-btn">&lsaquo;</button>
          <h2 className="cal-title">{MONTH_NAMES[calMonth]} {calYear}</h2>
          <button onClick={() => shiftMonth(1)} className="cal-nav-btn">&rsaquo;</button>
        </div>
        <div className="cal-header-right">
          <button onClick={goToday} className="page-btn">Today</button>
          <select
            className="filter-select"
            value={calMonth}
            onChange={e => setCalMonth(Number(e.target.value))}
          >
            {MONTH_SHORT.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select
            className="filter-select"
            value={calYear}
            onChange={e => setCalYear(Number(e.target.value))}
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="cal-layout">
        {/* Calendar Grid */}
        <div className="cal-grid-container">
          {/* Day headers */}
          <div className="cal-dow-row">
            <div className="cal-week-gutter" />
            {DAY_NAMES.map(d => <div key={d} className="cal-dow">{d}</div>)}
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
                {/* Week gutter tab */}
                <div
                  className={`cal-week-gutter-tab ${selectedWeekKey === weekKey ? 'active' : ''}`}
                  onClick={() => openWeek(week)}
                >
                  {hasWeekTrades ? (
                    <div className="cal-week-gutter-content">
                      <div className="cal-week-gutter-dot" style={{ background: weekPnl >= 0 ? 'var(--profit-color)' : 'var(--loss-color)' }} />
                      <div className="cal-week-gutter-pnl" style={{ color: weekPnl >= 0 ? 'var(--profit-color)' : 'var(--loss-color)' }}>
                        {formatPnl(weekPnl)}
                      </div>
                    </div>
                  ) : (
                    <div className="cal-week-gutter-empty">&mdash;</div>
                  )}
                </div>

                {/* Day cells */}
                {week.map((c, ci) => {
                  if (c.otherMonth) {
                    return (
                      <div key={ci} className="cal-cell other-month">
                        <span className="cal-cell-day">{c.day}</span>
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
                      className={`cal-cell${isActive ? ' active' : ''}`}
                      onClick={() => openDay(key)}
                    >
                      <span className={`cal-cell-day${isToday ? ' today' : ''}`}>{c.day}</span>
                      {data && (
                        <div className="cal-cell-data">
                          <div className={`cal-cell-pnl ${data.pnl >= 0 ? 'profit' : 'loss'}`}>
                            {formatPnl(data.pnl)}
                          </div>
                          <div className="cal-cell-count">
                            {data.trades.length} trade{data.trades.length !== 1 ? 's' : ''}
                          </div>
                        </div>
                      )}
                      {data && (
                        <div className={`cal-cell-bar ${data.pnl >= 0 ? 'profit' : 'loss'}`} />
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
          <div className="cal-sidebar">
            <div className="cal-sidebar-header">
              <h3 className="cal-sidebar-title">
                {selectedDate.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </h3>
              <button className="cal-sidebar-close" onClick={() => setSelectedDayKey(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Summary card */}
            {selectedDayData && selectedDayData.trades.length > 0 ? (
              <div className={`cal-summary-card ${selectedDayData.pnl >= 0 ? 'profit' : 'loss'}`}>
                <div className="cal-summary-label">{selectedDayData.pnl >= 0 ? 'Total Profit' : 'Total Loss'}</div>
                <div className={`cal-summary-value ${selectedDayData.pnl >= 0 ? 'profit-text' : 'loss-text'}`}>
                  {formatPnl(selectedDayData.pnl)}
                </div>
                <div className="cal-summary-sub">{selectedDayData.trades.length} Trade{selectedDayData.trades.length !== 1 ? 's' : ''}</div>
              </div>
            ) : (
              <div className="cal-summary-card flat">
                <div className="cal-summary-label">No trades this day</div>
              </div>
            )}

            {/* Day Notes */}
            <div className="cal-section-label">Daily Notes</div>
            <textarea
              className="note-area"
              placeholder="Add notes about your trading day..."
              value={dayNote}
              onChange={e => handleDayNoteChange(e.target.value)}
              style={{ minHeight: 180 }}
            />

            {/* Trades list */}
            <div className="cal-section-label" style={{ marginTop: 16 }}>Trades</div>
            {selectedDayData?.trades.map(t => {
              const isWin = (t.pnl - t.fees) >= 0;
              return (
                <div key={t.id} className="cal-trade-item">
                  <div className="cal-trade-bar" style={{ background: isWin ? 'var(--profit-color)' : 'var(--loss-color)' }} />
                  <div style={{ flex: 1 }}>
                    <div className="font-bold" style={{ fontSize: 12 }}>{t.coin}</div>
                    <div className="secondary-text" style={{ fontSize: 10 }}>
                      {t.side === 'B' ? '\u2197 Long' : '\u2198 Short'} &middot; {formatHold(t.hold_ms)}
                    </div>
                  </div>
                  <div className={`${isWin ? 'profit-text' : 'loss-text'} font-bold`} style={{ fontSize: 12 }}>
                    {formatPnl(t.pnl - t.fees)}
                  </div>
                </div>
              );
            })}
            {(!selectedDayData || selectedDayData.trades.length === 0) && (
              <div className="secondary-text text-xs" style={{ padding: '8px 0' }}>No trades</div>
            )}

            {/* View in Journal button */}
            <button
              className="cal-journal-btn"
              style={{ marginTop: 16 }}
              onClick={() => navigate(`/journal?from=${selectedDayKey}&to=${selectedDayKey}`)}
            >
              View Day in Journal
            </button>
          </div>
        )}

        {/* Week Sidebar */}
        {selectedWeekData && selectedWeekKey && (
          <div className="cal-sidebar">
            <div className="cal-sidebar-header">
              <h3 className="cal-sidebar-title accent-text">
                Week of {(() => {
                  const cells = selectedWeekData.week.filter(c => c.date);
                  const f = cells[0]?.date;
                  const l = cells[cells.length-1]?.date;
                  return f && l ? `${f.getDate()} ${MONTHS[f.getMonth()]} \u2013 ${l.getDate()} ${MONTHS[l.getMonth()]}` : 'Weekly Review';
                })()}
              </h3>
              <button className="cal-sidebar-close" onClick={() => setSelectedWeekKey(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Week P&L Summary */}
            <div className={`cal-summary-card ${selectedWeekData.pnl >= 0 ? 'profit' : 'loss'}`}>
              <div className="cal-summary-label">Week P&amp;L</div>
              <div className={`cal-summary-value ${selectedWeekData.pnl >= 0 ? 'profit-text' : 'loss-text'}`}>
                {formatPnl(selectedWeekData.pnl)}
              </div>
              <div className="cal-summary-sub">
                {selectedWeekData.trades.length} trades &middot; {selectedWeekData.wins}W / {selectedWeekData.losses}L
              </div>
            </div>

            {/* Stats row */}
            <div className="cal-stats-row">
              <div className="cal-stat-card">
                <div className="cal-stat-label">Win Rate</div>
                <div className={`cal-stat-value ${parseInt(selectedWeekData.winRate) >= 50 ? 'profit-text' : 'loss-text'}`}>
                  {selectedWeekData.winRate}%
                </div>
              </div>
              <div className="cal-stat-card">
                <div className="cal-stat-label">Avg R:R</div>
                <div className="cal-stat-value accent-text">{selectedWeekData.rr}</div>
              </div>
              <div className="cal-stat-card">
                <div className="cal-stat-label">Fees</div>
                <div className="cal-stat-value loss-text">-${selectedWeekData.fees.toFixed(2)}</div>
              </div>
            </div>

            {/* Day Breakdown */}
            <div className="cal-section-label">Day Breakdown</div>
            {selectedWeekData.week.map((c, i) => {
              if (!c.date) return null;
              const key = dateToKey(c.date);
              const data = dayMap[key];
              const pnl = data ? data.pnl : null;
              const cnt = data ? data.trades.length : 0;
              return (
                <div
                  key={i}
                  className="cal-trade-item"
                  style={{ cursor: cnt > 0 ? 'pointer' : 'default' }}
                  onClick={() => cnt > 0 && openDay(key)}
                >
                  <div className="cal-trade-bar" style={{
                    background: pnl === null ? 'var(--border-color)' : pnl >= 0 ? 'var(--profit-color)' : 'var(--loss-color)'
                  }} />
                  <div style={{ flex: 1 }}>
                    <div className="font-bold" style={{ fontSize: 12 }}>{DAY_NAMES[i]} {c.day}</div>
                    <div className="secondary-text" style={{ fontSize: 10 }}>
                      {cnt > 0 ? `${cnt} trade${cnt !== 1 ? 's' : ''}` : 'No trades'}
                    </div>
                  </div>
                  <div className={`${pnl === null ? 'secondary-text' : pnl >= 0 ? 'profit-text' : 'loss-text'} font-bold`} style={{ fontSize: 12 }}>
                    {pnl === null ? '\u2014' : formatPnl(pnl)}
                  </div>
                </div>
              );
            })}

            {/* Weekly Review */}
            <div className="cal-section-label" style={{ marginTop: 16 }}>Weekly Review</div>
            <textarea
              className="note-area"
              placeholder="Weekly review — what went well, what to improve..."
              value={weekNotes.review}
              onChange={e => handleWeekNoteChange('review', e.target.value)}
              style={{ minHeight: 120 }}
            />

            <div className="cal-notes-grid">
              <div className="cal-notes-card">
                <div className="cal-notes-card-title profit-text">What Went Well</div>
                <textarea
                  className="note-area"
                  placeholder="Wins, good decisions..."
                  value={weekNotes.well}
                  onChange={e => handleWeekNoteChange('well', e.target.value)}
                  style={{ minHeight: 70, border: 'none', padding: 0, background: 'transparent' }}
                />
              </div>
              <div className="cal-notes-card">
                <div className="cal-notes-card-title loss-text">What to Improve</div>
                <textarea
                  className="note-area"
                  placeholder="Mistakes, patterns to break..."
                  value={weekNotes.improve}
                  onChange={e => handleWeekNoteChange('improve', e.target.value)}
                  style={{ minHeight: 70, border: 'none', padding: 0, background: 'transparent' }}
                />
              </div>
            </div>

            {/* View in Journal button */}
            <button
              className="cal-journal-btn"
              onClick={() => {
                const cells = selectedWeekData.week.filter(c => c.date);
                const first = cells[0]?.date;
                const last = cells[cells.length - 1]?.date;
                if (first && last) {
                  navigate(`/journal?from=${dateToKey(first)}&to=${dateToKey(last)}`);
                } else {
                  navigate('/journal');
                }
              }}
            >
              View Week in Journal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
