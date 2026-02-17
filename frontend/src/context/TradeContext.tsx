import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { Trade } from '../types';
import { getTrades, refreshTrades as apiRefresh } from '../api/client';
import { useWallet } from './WalletContext';

interface TradeContextValue {
  trades: Trade[];
  loading: boolean;
  error: string | null;
  refreshTrades: () => Promise<void>;
}

const TradeContext = createContext<TradeContextValue>({
  trades: [],
  loading: true,
  error: null,
  refreshTrades: async () => {},
});

export function TradeProvider({ children }: { children: ReactNode }) {
  const { wallet } = useWallet();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh trades');
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    loadTrades();
  }, [loadTrades]);

  return (
    <TradeContext.Provider value={{ trades, loading, error, refreshTrades: refresh }}>
      {children}
    </TradeContext.Provider>
  );
}

export function useTrades() {
  return useContext(TradeContext);
}
