import { useState, useRef, useEffect, useMemo } from 'react';

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW = ['Mo','Tu','We','Th','Fr','Sa','Su'];

type DateMode = 'range' | 'before' | 'after';
type GroupBy = 'open' | 'close';

interface Props {
  from: string;
  to: string;
  onApply: (from: string, to: string, groupBy: GroupBy) => void;
  onClear: () => void;
}

function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildCells(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const leading = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();

  type Cell = { day: number; key: string; otherMonth: boolean };
  const cells: Cell[] = [];

  for (let i = leading - 1; i >= 0; i--) {
    const d = new Date(year, month - 1, prevDays - i);
    cells.push({ day: prevDays - i, key: toKey(d), otherMonth: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    cells.push({ day: d, key: toKey(date), otherMonth: false });
  }
  const trailing = cells.length % 7 === 0 ? 0 : 7 - (cells.length % 7);
  for (let d = 1; d <= trailing; d++) {
    const date = new Date(year, month + 1, d);
    cells.push({ day: d, key: toKey(date), otherMonth: true });
  }

  const weeks: Cell[][] = [];
  for (let w = 0; w < cells.length / 7; w++) weeks.push(cells.slice(w * 7, w * 7 + 7));
  return weeks;
}

export default function DateFilter({ from, to, onApply, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const now = new Date();
  const [leftMonth, setLeftMonth] = useState(now.getMonth() === 0 ? 11 : now.getMonth() - 1);
  const [leftYear, setLeftYear] = useState(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());
  const [selFrom, setSelFrom] = useState(from);
  const [selTo, setSelTo] = useState(to);
  const [dateMode, setDateMode] = useState<DateMode>('range');
  const [groupBy, setGroupBy] = useState<GroupBy>('open');
  const [fromTime, setFromTime] = useState('00:00');
  const [toTime, setToTime] = useState('23:59');
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  // Right month is always left + 1
  const rightMonth = leftMonth === 11 ? 0 : leftMonth + 1;
  const rightYear = leftMonth === 11 ? leftYear + 1 : leftYear;

  const leftWeeks = useMemo(() => buildCells(leftYear, leftMonth), [leftYear, leftMonth]);
  const rightWeeks = useMemo(() => buildCells(rightYear, rightMonth), [rightYear, rightMonth]);

  // Sync from props when dropdown opens
  useEffect(() => {
    if (open) {
      setSelFrom(from);
      setSelTo(to);
      if (from && !to) setDateMode('after');
      else if (!from && to) setDateMode('before');
      else setDateMode('range');
    }
  }, [open, from, to]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function shiftLeft(dir: number) {
    let m = leftMonth + dir;
    let y = leftYear;
    if (m > 11) { m = 0; y++; }
    if (m < 0) { m = 11; y--; }
    setLeftMonth(m);
    setLeftYear(y);
  }

  function handleDayClick(key: string) {
    if (dateMode === 'before') {
      setSelTo(key);
      setSelFrom('');
    } else if (dateMode === 'after') {
      setSelFrom(key);
      setSelTo('');
    } else {
      // Range mode
      if (!selFrom || (selFrom && selTo)) {
        // Start new selection
        setSelFrom(key);
        setSelTo('');
      } else {
        // Complete selection
        if (key < selFrom) {
          setSelTo(selFrom);
          setSelFrom(key);
        } else {
          setSelTo(key);
        }
      }
    }
  }

  function isInRange(key: string): boolean {
    if (dateMode !== 'range') return false;
    const start = selFrom;
    const end = selTo || hoverKey;
    if (!start || !end) return false;
    const lo = start < end ? start : end;
    const hi = start < end ? end : start;
    return key >= lo && key <= hi;
  }

  function isStart(key: string) { return key === selFrom; }
  function isEnd(key: string) {
    if (dateMode === 'range') return key === (selTo || (hoverKey && !selTo ? hoverKey : ''));
    return key === selTo;
  }

  function handleApply() {
    onApply(selFrom, selTo, groupBy);
    setOpen(false);
  }

  function handleClear() {
    setSelFrom('');
    setSelTo('');
    onClear();
    setOpen(false);
  }

  function applyPreset(fromDate: Date, toDate: Date) {
    setSelFrom(toKey(fromDate));
    setSelTo(toKey(toDate));
    setDateMode('range');
  }

  // Preset helpers
  const today = new Date(); today.setHours(0,0,0,0);
  const presets = useMemo(() => {
    const t = new Date(); t.setHours(0,0,0,0);
    const yesterday = new Date(t); yesterday.setDate(t.getDate() - 1);
    const dowToday = t.getDay() === 0 ? 6 : t.getDay() - 1; // Mon=0
    const thisWeekStart = new Date(t); thisWeekStart.setDate(t.getDate() - dowToday);
    const thisWeekEnd = new Date(thisWeekStart); thisWeekEnd.setDate(thisWeekStart.getDate() + 6);
    const lastWeekStart = new Date(thisWeekStart); lastWeekStart.setDate(thisWeekStart.getDate() - 7);
    const lastWeekEnd = new Date(thisWeekStart); lastWeekEnd.setDate(thisWeekStart.getDate() - 1);
    const thisMonthStart = new Date(t.getFullYear(), t.getMonth(), 1);
    const thisMonthEnd = new Date(t.getFullYear(), t.getMonth() + 1, 0);
    const lastMonthStart = new Date(t.getFullYear(), t.getMonth() - 1, 1);
    const lastMonthEnd = new Date(t.getFullYear(), t.getMonth(), 0);
    const last7 = new Date(t); last7.setDate(t.getDate() - 6);
    const last30 = new Date(t); last30.setDate(t.getDate() - 29);
    const last90 = new Date(t); last90.setDate(t.getDate() - 89);
    const ytdStart = new Date(t.getFullYear(), 0, 1);

    return [
      { label: 'Today', from: t, to: t },
      { label: 'Yesterday', from: yesterday, to: yesterday },
      { label: 'This Week', from: thisWeekStart, to: thisWeekEnd },
      { label: 'Last Week', from: lastWeekStart, to: lastWeekEnd },
      { label: 'This Month', from: thisMonthStart, to: thisMonthEnd },
      { label: 'Last Month', from: lastMonthStart, to: lastMonthEnd },
      { label: 'Last 7 Days', from: last7, to: t },
      { label: 'Last 30 Days', from: last30, to: t },
      { label: 'Last 90 Days', from: last90, to: t },
      { label: 'Year to Date', from: ytdStart, to: t },
    ];
  }, []);

  // Button label
  const hasFilter = from || to;
  let btnLabel = 'Date Filter';
  if (from && to && from === to) btnLabel = from;
  else if (from && to) btnLabel = `${from} \u2013 ${to}`;
  else if (from) btnLabel = `From ${from}`;
  else if (to) btnLabel = `Until ${to}`;

  function renderCalendar(weeks: ReturnType<typeof buildCells>) {
    return (
      <div className="df-cal">
        <div className="df-dow-row">
          {DOW.map(d => <div key={d} className="df-dow">{d}</div>)}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="df-week-row">
            {week.map((cell, ci) => {
              const inRange = isInRange(cell.key);
              const start = isStart(cell.key);
              const end = isEnd(cell.key);
              const isToday = cell.key === toKey(today);
              return (
                <div
                  key={ci}
                  className={[
                    'df-day',
                    cell.otherMonth ? 'other' : '',
                    inRange ? 'in-range' : '',
                    start ? 'range-start' : '',
                    end ? 'range-end' : '',
                    isToday ? 'today' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => handleDayClick(cell.key)}
                  onMouseEnter={() => { if (selFrom && !selTo && dateMode === 'range') setHoverKey(cell.key); }}
                >
                  {cell.day}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="df-wrapper" ref={ref}>
      <button
        className={`page-btn df-trigger${hasFilter ? ' active' : ''}`}
        onClick={() => setOpen(!open)}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        {btnLabel}
      </button>

      {open && (
        <div className="df-dropdown">
          {/* Left: Presets */}
          <div className="df-presets">
            <div className="df-presets-title">Quick Select</div>
            {presets.map(p => (
              <button
                key={p.label}
                className={`df-preset-btn${selFrom === toKey(p.from) && selTo === toKey(p.to) ? ' active' : ''}`}
                onClick={() => applyPreset(p.from, p.to)}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Right: Calendar area */}
          <div className="df-main">
            {/* Top controls: Date Mode + Group By */}
            <div className="df-controls-row">
              <div className="df-control-group">
                <span className="df-control-label">Group By</span>
                <div className="df-toggle-group">
                  <button className={`df-toggle-btn${groupBy === 'open' ? ' active' : ''}`} onClick={() => setGroupBy('open')}>Trade Open</button>
                  <button className={`df-toggle-btn${groupBy === 'close' ? ' active' : ''}`} onClick={() => setGroupBy('close')}>Trade Close</button>
                </div>
              </div>
              <div className="df-control-group">
                <span className="df-control-label">Date Mode</span>
                <div className="df-toggle-group">
                  <button className={`df-toggle-btn${dateMode === 'before' ? ' active' : ''}`} onClick={() => { setDateMode('before'); setSelFrom(''); }}>Before</button>
                  <button className={`df-toggle-btn${dateMode === 'range' ? ' active' : ''}`} onClick={() => setDateMode('range')}>Range</button>
                  <button className={`df-toggle-btn${dateMode === 'after' ? ' active' : ''}`} onClick={() => { setDateMode('after'); setSelTo(''); }}>After</button>
                </div>
              </div>
            </div>

            {/* Calendar Navigation */}
            <div className="df-cal-nav">
              <button className="cal-nav-btn" onClick={() => shiftLeft(-1)}>&lsaquo;</button>
              <div className="df-cal-titles">
                <span className="df-cal-month-title">{MONTH_NAMES[leftMonth]} {leftYear}</span>
                <span className="df-cal-month-title">{MONTH_NAMES[rightMonth]} {rightYear}</span>
              </div>
              <button className="cal-nav-btn" onClick={() => shiftLeft(1)}>&rsaquo;</button>
            </div>

            {/* Dual Calendars */}
            <div className="df-cal-pair">
              {renderCalendar(leftWeeks)}
              {renderCalendar(rightWeeks)}
            </div>

            {/* Time inputs + summary */}
            <div className="df-time-row">
              <div className="df-time-field">
                <label className="df-control-label">From</label>
                <input type="date" className="df-date-input" value={selFrom} onChange={e => setSelFrom(e.target.value)} />
                <input type="time" className="df-time-input" value={fromTime} onChange={e => setFromTime(e.target.value)} />
              </div>
              <div className="df-time-field">
                <label className="df-control-label">To</label>
                <input type="date" className="df-date-input" value={selTo} onChange={e => setSelTo(e.target.value)} />
                <input type="time" className="df-time-input" value={toTime} onChange={e => setToTime(e.target.value)} />
              </div>
            </div>

            {/* Action buttons */}
            <div className="df-actions">
              <button className="df-clear-btn" onClick={handleClear}>Clear</button>
              <button className="df-apply-btn" onClick={handleApply}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
