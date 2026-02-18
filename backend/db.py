import sqlite3
import os
from config import DB_PATH


def get_db():
    """Get a database connection with row factory enabled."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Create all tables if they don't exist."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS fills (
            tid INTEGER PRIMARY KEY,
            coin TEXT NOT NULL,
            px TEXT NOT NULL,
            sz TEXT NOT NULL,
            side TEXT NOT NULL,
            dir TEXT NOT NULL,
            time INTEGER NOT NULL,
            start_position TEXT NOT NULL,
            closed_pnl TEXT NOT NULL,
            fee TEXT NOT NULL,
            oid INTEGER NOT NULL,
            hash TEXT,
            crossed INTEGER,
            wallet TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_fills_wallet_time ON fills(wallet, time);
        CREATE INDEX IF NOT EXISTS idx_fills_wallet_coin ON fills(wallet, coin);

        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wallet TEXT NOT NULL,
            coin TEXT NOT NULL,
            side TEXT NOT NULL,
            entry_px REAL NOT NULL,
            exit_px REAL,
            size REAL NOT NULL,
            pnl REAL NOT NULL,
            fees REAL NOT NULL,
            open_time INTEGER NOT NULL,
            close_time INTEGER,
            hold_ms INTEGER,
            mae REAL,
            mfe REAL,
            fill_ids TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_trades_wallet ON trades(wallet);
        CREATE INDEX IF NOT EXISTS idx_trades_wallet_time ON trades(wallet, open_time);

        CREATE TABLE IF NOT EXISTS trade_notes (
            trade_id INTEGER PRIMARY KEY REFERENCES trades(id),
            notes TEXT DEFAULT '',
            updated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS trade_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_id INTEGER NOT NULL REFERENCES trades(id),
            tag TEXT NOT NULL,
            UNIQUE(trade_id, tag)
        );

        CREATE TABLE IF NOT EXISTS trade_screenshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trade_id INTEGER NOT NULL REFERENCES trades(id),
            filename TEXT NOT NULL,
            original_name TEXT,
            uploaded_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS calendar_notes (
            date_key TEXT PRIMARY KEY,
            notes TEXT DEFAULT '',
            updated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS week_notes (
            week_key TEXT PRIMARY KEY,
            review TEXT DEFAULT '',
            well TEXT DEFAULT '',
            improve TEXT DEFAULT '',
            updated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS funding (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wallet TEXT NOT NULL,
            coin TEXT NOT NULL,
            usdc REAL NOT NULL,
            time INTEGER NOT NULL,
            hash TEXT NOT NULL,
            UNIQUE(wallet, hash)
        );

        CREATE INDEX IF NOT EXISTS idx_funding_wallet_time ON funding(wallet, time);
        CREATE INDEX IF NOT EXISTS idx_funding_wallet_coin_time ON funding(wallet, coin, time);
    """)
    conn.commit()
    conn.close()
