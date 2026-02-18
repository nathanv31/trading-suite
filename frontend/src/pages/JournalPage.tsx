import { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTrades } from '../context/TradeContext';
import JournalRow from '../components/Journal/JournalRow';
import TagFilter from '../components/TagFilter';
import DateFilter from '../components/DateFilter';

const PER_PAGE = 20;

type SortCol = 'symbol' | 'side' | 'time' | 'hold' | 'entry' | 'mae' | 'mfe' | 'fees' | 'pnl';
type SortDir = 'desc' | 'asc';

export default function JournalPage() {
  const { trades, loading, error, refreshTrades, tagMap, allTags } = useTrades();
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [sideFilter, setSideFilter] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [coinFilter, setCoinFilter] = useState('');
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [tagLogic, setTagLogic] = useState<'any' | 'all'>('any');
  const [dateGroupBy, setDateGroupBy] = useState<'open' | 'close'>('open');

  const cycleSort = useCallback((col: SortCol) => {
    setSortCol(prev => {
      if (prev !== col) { setSortDir('desc'); return col; }
      if (sortDir === 'desc') { setSortDir('asc'); return col; }
      setSortDir('desc'); return null;
    });
    setPage(1);
  }, [sortDir]);

  const dateFrom = searchParams.get('from') || '';
  const dateTo = searchParams.get('to') || '';

  const coins = useMemo(() => [...new Set(trades.map(t => t.coin))].sort(), [trades]);

  const filtered = useMemo(() => {
    let list = [...trades];

    // Date range filter
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

    if (!sortCol) {
      list.sort((a, b) => b.open_time - a.open_time);
    } else {
      const dir = sortDir === 'desc' ? -1 : 1;
      list.sort((a, b) => {
        let cmp = 0;
        switch (sortCol) {
          case 'symbol': cmp = a.coin.localeCompare(b.coin); break;
          case 'side': cmp = a.side.localeCompare(b.side); break;
          case 'time': cmp = a.open_time - b.open_time; break;
          case 'hold': cmp = (a.hold_ms ?? 0) - (b.hold_ms ?? 0); break;
          case 'entry': cmp = a.entry_px - b.entry_px; break;
          case 'mae': cmp = (a.mae ?? 0) - (b.mae ?? 0); break;
          case 'mfe': cmp = (a.mfe ?? 0) - (b.mfe ?? 0); break;
          case 'fees': cmp = a.fees - b.fees; break;
          case 'pnl': cmp = (a.pnl - a.fees) - (b.pnl - b.fees); break;
        }
        return cmp * dir;
      });
    }

    return list;
  }, [trades, sideFilter, resultFilter, coinFilter, sortCol, sortDir, selectedTags, tagLogic, tagMap, dateFrom, dateTo, dateGroupBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PER_PAGE;
  const pageItems = filtered.slice(start, start + PER_PAGE);

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

  return (
    <div className="p-6">
      {/* Filter Bar */}
      <div className="flex gap-3 mb-5 flex-wrap items-center">
        <DateFilter
          from={dateFrom}
          to={dateTo}
          onApply={(from, to, groupBy) => {
            setDateGroupBy(groupBy);
            const params: Record<string, string> = {};
            if (from) params.from = from;
            if (to) params.to = to;
            setSearchParams(params);
            setPage(1);
          }}
          onClear={() => {
            setSearchParams({});
            setPage(1);
          }}
        />
        <select className="filter-select" value={sideFilter} onChange={e => { setSideFilter(e.target.value); setPage(1); }}>
          <option value="">All Sides</option>
          <option value="B">Long</option>
          <option value="A">Short</option>
        </select>
        <select className="filter-select" value={resultFilter} onChange={e => { setResultFilter(e.target.value); setPage(1); }}>
          <option value="">Win / Loss</option>
          <option value="win">Wins</option>
          <option value="loss">Losses</option>
        </select>
        <select className="filter-select" value={coinFilter} onChange={e => { setCoinFilter(e.target.value); setPage(1); }}>
          <option value="">All Coins</option>
          {coins.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <TagFilter
          allTags={allTags}
          selectedTags={selectedTags}
          logic={tagLogic}
          onTagsChange={tags => { setSelectedTags(tags); setPage(1); }}
          onLogicChange={setTagLogic}
        />
        <div className="ml-auto secondary-text text-xs">
          Showing {start + 1}&ndash;{Math.min(start + PER_PAGE, filtered.length)} of {filtered.length}
        </div>
      </div>

      {/* Column Headers */}
      <div className="journal-header text-xs secondary-text mb-2">
        <div style={{ width: 4, flexShrink: 0 }} />
        <div style={{ width: 28, flexShrink: 0 }} />
        {([
          ['symbol', 'Symbol'],
          ['side', 'Side & Size'],
          ['time', 'Open & Close'],
          ['hold', 'Hold Time'],
          ['entry', 'Entry \u2192 Exit'],
          ['mae', 'MAE'],
          ['mfe', 'MFE'],
          ['fees', 'Fees'],
          ['pnl', 'PnL'],
        ] as [SortCol, string][]).map(([col, label]) => (
          <div
            key={col}
            className={`jcol-${col === 'time' ? 'times' : col} journal-sort-header${sortCol === col ? ' active' : ''}`}
            onClick={() => cycleSort(col)}
          >
            {label}
            {sortCol === col && (
              <span className="sort-indicator">{sortDir === 'desc' ? ' \u25BC' : ' \u25B2'}</span>
            )}
          </div>
        ))}
        <div style={{ width: 28, flexShrink: 0 }} />
      </div>

      {/* Trade Rows */}
      {pageItems.map(trade => (
        <JournalRow key={trade.id} trade={trade} />
      ))}

      {/* Pagination */}
      <div className="flex justify-between items-center mt-4 secondary-text text-xs">
        <button className="page-btn" disabled={currentPage <= 1} onClick={() => setPage(p => p - 1)}>
          &larr; Prev
        </button>
        <span>Page {currentPage} / {totalPages}</span>
        <button className="page-btn" disabled={currentPage >= totalPages} onClick={() => setPage(p => p + 1)}>
          Next &rarr;
        </button>
      </div>
    </div>
  );
}
