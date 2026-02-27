import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { Trade } from '../types';
import { getTrades, refreshTrades as apiRefresh, getTradeTagsMap, getAllTags, getEnrichmentStatus } from '../api/client';
import { useWallet } from './WalletContext';

interface TradeContextValue {
  trades: Trade[];
  loading: boolean;
  error: string | null;
  refreshTrades: () => Promise<void>;
  tagMap: Record<string, string[]>;
  allTags: string[];
  reloadTags: () => Promise<void>;
  enriching: boolean;
}

const TradeContext = createContext<TradeContextValue>({
  trades: [],
  loading: true,
  error: null,
  refreshTrades: async () => {},
  tagMap: {},
  allTags: [],
  reloadTags: async () => {},
  enriching: false,
});

export function TradeProvider({ children }: { children: ReactNode }) {
  const { wallet } = useWallet();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tagMap, setTagMap] = useState<Record<string, string[]>>({});
  const [allTags, setAllTags] = useState<string[]>([]);
  const [enriching, setEnriching] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCountRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    pollCountRef.current = 0;
  }, []);

  const startPolling = useCallback(() => {
    if (!wallet) return;
    stopPolling();
    setEnriching(true);
    pollCountRef.current = 0;

    const poll = async () => {
      try {
        const status = await getEnrichmentStatus(wallet);
        if (status.status === 'completed') {
          stopPolling();
          setEnriching(false);
          // Silently reload trades to pick up enriched MAE/MFE
          const data = await getTrades(wallet);
          setTrades(data);
          return;
        } else if (status.status === 'failed' || status.status === 'idle') {
          stopPolling();
          setEnriching(false);
          return;
        }
        // 'running' — schedule next poll (fast at first, slower after)
      } catch {
        // Network error — keep polling, will retry
      }
      pollCountRef.current++;
      const delay = pollCountRef.current <= 5 ? 500 : 2000;
      pollRef.current = setTimeout(poll, delay);
    };

    // First check after 500ms
    pollRef.current = setTimeout(poll, 500);
  }, [wallet, stopPolling]);

  const loadTags = useCallback(async () => {
    if (!wallet) return;
    try {
      const [map, tags] = await Promise.all([
        getTradeTagsMap(wallet),
        getAllTags(),
      ]);
      setTagMap(map);
      setAllTags(tags);
    } catch {
      // Non-critical, don't block trades loading
    }
  }, [wallet]);

  const loadTrades = useCallback(async () => {
    if (!wallet) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getTrades(wallet);
      setTrades(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trades');
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  const refresh = useCallback(async () => {
    if (!wallet) return;
    try {
      setLoading(true);
      setError(null);
      const data = await apiRefresh(wallet);
      setTrades(data);
      // Start polling for background enrichment completion
      startPolling();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh trades');
    } finally {
      setLoading(false);
    }
  }, [wallet, startPolling]);

  useEffect(() => {
    loadTrades();
  }, [loadTrades]);

  // Check if enrichment is already running (e.g., page refresh mid-enrichment)
  useEffect(() => {
    if (!wallet || loading) return;
    getEnrichmentStatus(wallet).then(status => {
      if (status.status === 'running') {
        startPolling();
      }
    }).catch(() => {});
  }, [wallet, loading, startPolling]);

  // Load tags after trades are loaded
  useEffect(() => {
    if (trades.length > 0) {
      loadTags();
    }
  }, [trades, loadTags]);

  // Cleanup polling on unmount
  useEffect(() => stopPolling, [stopPolling]);

  return (
    <TradeContext.Provider value={{ trades, loading, error, refreshTrades: refresh, tagMap, allTags, reloadTags: loadTags, enriching }}>
      {children}
    </TradeContext.Provider>
  );
}

export function useTrades() {
  return useContext(TradeContext);
}
