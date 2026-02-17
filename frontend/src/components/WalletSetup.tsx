import { useState } from 'react';
import { useWallet } from '../context/WalletContext';

export default function WalletSetup() {
  const { setWallet } = useWallet();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed.match(/^0x[a-fA-F0-9]{40}$/)) {
      setError('Please enter a valid Ethereum address (0x...)');
      return;
    }
    setWallet(trimmed);
  };

  return (
    <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg-primary)' }}>
      <div className="w-full max-w-md" style={{ padding: '40px' }}>
        <div className="flex items-center gap-3 mb-2">
          <svg className="w-8 h-8" style={{ color: 'var(--accent-yellow)' }} fill="currentColor" viewBox="0 0 24 24">
            <path d="M13 2L3 14h8l-2 8 10-12h-8l2-8z" />
          </svg>
          <h1 className="text-2xl font-bold accent-text">HyperAnalytics</h1>
        </div>

        <p className="secondary-text mb-8" style={{ fontSize: '13px' }}>
          Enter your Hyperliquid wallet address to get started. It will be stored locally in your browser — never sent to any third-party server.
        </p>

        <form onSubmit={handleSubmit}>
          <label className="block mb-2" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)' }}>
            Wallet Address
          </label>
          <input
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(''); }}
            placeholder="0x..."
            spellCheck={false}
            autoFocus
            style={{
              width: '100%',
              background: 'var(--bg-secondary)',
              border: `1px solid ${error ? 'var(--loss-color)' : 'var(--border-color)'}`,
              color: 'var(--text-primary)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '14px',
              borderRadius: '8px',
              padding: '14px 16px',
              boxSizing: 'border-box',
              transition: 'border-color 0.15s',
            }}
          />
          {error && (
            <p className="loss-text mt-2" style={{ fontSize: '12px' }}>{error}</p>
          )}

          <button
            type="submit"
            className="btn-primary mt-6"
            style={{ width: '100%', padding: '14px', fontSize: '14px' }}
          >
            Connect Wallet
          </button>

          <p className="secondary-text mt-4 text-center" style={{ fontSize: '11px' }}>
            Your address is only stored in localStorage and is sent directly to the Hyperliquid public API.
          </p>
        </form>
      </div>
    </div>
  );
}
