import { useState, useMemo } from 'react';
import { useTrades } from '../context/TradeContext';
import JournalRow from '../components/Journal/JournalRow';

const PER_PAGE = 20;

export default function JournalPage() {
  const { trades, loading } = useTrades();
  const [page, setPage] = useState(1);
  const [sideFilter, setSideFilter] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [coinFilter, setCoinFilter] = useState('');
  const [sortMode, setSortMode] = useState('newest');

  const coins = useMemo(() => [...new Set(trades.map(t => t.coin))].sort(), [trades]);

  const filtered = useMemo(() => {
    let list = [...trades];
    if (sideFilter) list = list.filter(t => t.side === sideFilter);
    if (resultFilter === 'win') list = list.filter(t => t.pnl > 0);
    if (resultFilter === 'loss') list = list.filter(t => t.pnl < 0);
    if (coinFilter) list = list.filter(t => t.coin === coinFilter);

    if (sortMode === 'newest') list.sort((a, b) => b.open_time - a.open_time);
    else if (sortMode === 'oldest') list.sort((a, b) => a.open_time - b.open_time);
    else if (sortMode === 'pnl_desc') list.sort((a, b) => b.pnl - a.pnl);
    else if (sortMode === 'pnl_asc') list.sort((a, b) => a.pnl - b.pnl);

    return list;
  }, [trades, sideFilter, resultFilter, coinFilter, sortMode]);

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

  return (
    <div className="p-6">
      {/* Filter Bar */}
      <div className="flex gap-3 mb-5 flex-wrap items-center">
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
        <select className="filter-select" value={sortMode} onChange={e => setSortMode(e.target.value)}>
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="pnl_desc">Best PnL</option>
          <option value="pnl_asc">Worst PnL</option>
        </select>
        <div className="ml-auto secondary-text text-xs">
          Showing {start + 1}&ndash;{Math.min(start + PER_PAGE, filtered.length)} of {filtered.length}
        </div>
      </div>

      {/* Column Headers */}
      <div className="journal-header text-xs secondary-text mb-2">
        <div style={{ width: 4, flexShrink: 0 }} />
        <div className="jcol-symbol">Symbol</div>
        <div className="jcol-side">Side &amp; Size</div>
        <div className="jcol-times">Open &amp; Close</div>
        <div className="jcol-hold">Hold Time</div>
        <div className="jcol-entry">Entry &rarr; Exit</div>
        <div className="jcol-mae">MAE</div>
        <div className="jcol-mfe">MFE</div>
        <div className="jcol-fees">Fees</div>
        <div className="jcol-pnl">PnL</div>
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
