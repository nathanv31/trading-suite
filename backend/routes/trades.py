"""Trade endpoints — fetch, process, and serve grouped trades."""

import json
import time
from flask import Blueprint, request, jsonify
from db import get_db
from hl_client import HyperliquidClient
from trade_processor import process_fills_to_trades
trades_bp = Blueprint("trades", __name__)
hl = HyperliquidClient()


def _get_wallet():
    wallet = request.args.get("wallet")
    if not wallet:
        return None
    return wallet


def _cache_fills(wallet, fills):
    """Store fills in SQLite, skipping duplicates."""
    conn = get_db()
    for f in fills:
        try:
            conn.execute(
                """INSERT OR IGNORE INTO fills
                   (tid, coin, px, sz, side, dir, time, start_position,
                    closed_pnl, fee, oid, hash, crossed, wallet)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    f.get("tid", f.get("oid")),
                    f["coin"],
                    f["px"],
                    f["sz"],
                    f["side"],
                    f.get("dir", ""),
                    f["time"],
                    f.get("startPosition", "0"),
                    f.get("closedPnl", "0"),
                    f.get("fee", "0"),
                    f["oid"],
                    f.get("hash", ""),
                    1 if f.get("crossed") else 0,
                    wallet,
                ),
            )
        except Exception as e:
            print(f"[DB] Skipping fill: {e}")
    conn.commit()
    conn.close()


def _cache_trades(wallet, trades):
    """Store grouped trades in SQLite, replacing existing ones for this wallet."""
    conn = get_db()
    conn.execute("DELETE FROM trades WHERE wallet = ?", (wallet,))
    for t in trades:
        conn.execute(
            """INSERT INTO trades
               (wallet, coin, side, entry_px, exit_px, size, pnl, fees,
                open_time, close_time, hold_ms, mae, mfe, fill_ids)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                wallet,
                t["coin"],
                t["side"],
                t["entry_px"],
                t.get("exit_px"),
                t["size"],
                t["pnl"],
                t["fees"],
                t["open_time"],
                t.get("close_time"),
                t.get("hold_ms"),
                t.get("mae"),
                t.get("mfe"),
                t["fill_ids"],
            ),
        )
    conn.commit()
    conn.close()


def _load_cached_trades(wallet):
    """Load trades from cache, return list of dicts or None if empty."""
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM trades WHERE wallet = ? ORDER BY open_time", (wallet,)
    ).fetchall()
    conn.close()
    if not rows:
        return None
    return [dict(r) for r in rows]


def _fetch_and_process(wallet):
    """Fetch fills from Hyperliquid, process into trades, cache both."""
    print(f"[TRADES] Fetching all fills for {wallet}...")
    fills = hl.fetch_all_fills(wallet)
    if not fills:
        return []

    print(f"[TRADES] Got {len(fills)} fills, caching...")
    _cache_fills(wallet, fills)

    print(f"[TRADES] Processing fills into trades...")
    trades = process_fills_to_trades(fills)
    print(f"[TRADES] Found {len(trades)} round-trip trades")

    _cache_trades(wallet, trades)
    return trades


@trades_bp.route("/api/trades")
def get_trades():
    """Get all grouped trades. Uses cache if available."""
    wallet = _get_wallet()
    if not wallet:
        return jsonify({"error": "wallet query parameter is required"}), 400

    # Try cache first
    cached = _load_cached_trades(wallet)
    if cached is not None:
        return jsonify(cached)

    # Fetch from Hyperliquid
    try:
        trades = _fetch_and_process(wallet)
    except Exception as e:
        print(f"[TRADES] Error fetching trades: {e}")
        return jsonify({"error": f"Failed to fetch trades from Hyperliquid: {e}"}), 502

    # Re-load from DB to get auto-generated IDs
    result = _load_cached_trades(wallet)
    return jsonify(result or [])


@trades_bp.route("/api/trades/refresh", methods=["POST"])
def refresh_trades():
    """Force re-fetch from Hyperliquid and reprocess."""
    wallet = _get_wallet()
    if not wallet:
        return jsonify({"error": "wallet query parameter is required"}), 400
    try:
        trades = _fetch_and_process(wallet)
    except Exception as e:
        print(f"[TRADES] Error refreshing trades: {e}")
        return jsonify({"error": f"Failed to fetch trades from Hyperliquid: {e}"}), 502

    result = _load_cached_trades(wallet)
    return jsonify(result or [])


@trades_bp.route("/api/state")
def get_state():
    """Get current account state (positions, margin, etc.)."""
    wallet = _get_wallet()
    if not wallet:
        return jsonify({"error": "wallet query parameter is required"}), 400
    try:
        state = hl.fetch_user_state(wallet)
    except Exception as e:
        print(f"[TRADES] Error fetching state: {e}")
        return jsonify({"error": f"Failed to fetch account state: {e}"}), 502

    return jsonify(state)


@trades_bp.route("/api/candles")
def get_candles():
    """Get candlestick data for a coin."""
    coin = request.args.get("coin", "BTC")
    interval = request.args.get("interval", "5m")
    start_time = int(request.args.get("start", 0))
    end_time = int(request.args.get("end", int(time.time() * 1000)))
    try:
        candles = hl.fetch_candles(coin, interval, start_time, end_time)
    except Exception as e:
        print(f"[TRADES] Error fetching candles: {e}")
        return jsonify({"error": f"Failed to fetch candle data: {e}"}), 502

    return jsonify(candles if isinstance(candles, list) else [])
