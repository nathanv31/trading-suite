import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

const STORAGE_KEY = 'hl_wallet_address';

interface WalletContextValue {
  wallet: string | null;
  setWallet: (address: string) => void;
  clearWallet: () => void;
}

const WalletContext = createContext<WalletContextValue>({
  wallet: null,
  setWallet: () => {},
  clearWallet: () => {},
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWalletState] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY);
  });

  const setWallet = useCallback((address: string) => {
    const trimmed = address.trim();
    localStorage.setItem(STORAGE_KEY, trimmed);
    setWalletState(trimmed);
  }, []);

  const clearWallet = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setWalletState(null);
  }, []);

  return (
    <WalletContext.Provider value={{ wallet, setWallet, clearWallet }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
