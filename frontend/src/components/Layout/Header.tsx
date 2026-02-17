import { useLocation } from 'react-router-dom';
import { useTrades } from '../../context/TradeContext';

const PAGE_TITLES: Record<string, string> = {
  '/': 'My Home',
  '/analytics': 'Analytics',
  '/calendar': 'Calendar',
  '/journal': 'Journal',
};

export default function Header() {
  const location = useLocation();
  const { refreshTrades, loading } = useTrades();
  const title = PAGE_TITLES[location.pathname] || 'HyperAnalytics';

  return (
    <div
      className="p-6 flex justify-between items-center"
      style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}
    >
      <h2 className="text-2xl font-bold">{title}</h2>
      <div className="flex gap-4">
        <button
          className="page-btn"
          onClick={refreshTrades}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={loading ? { animation: 'spin 1s linear infinite' } : {}}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}
