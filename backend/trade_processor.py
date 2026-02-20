"""Process raw fills into grouped round-trip trades.

Uses the `dir` field from Hyperliquid fills to correctly identify
position opens and closes, rather than inferring from position math.

Fill `dir` values: "Open Long", "Close Long", "Open Short", "Close Short"
Fill `side` values: "B" (buy) or "A" (ask/sell)
"""

import json


def process_fills_to_trades(fills):
    """Group fills into round-trip trades.

    A trade starts when a position opens (dir starts with "Open")
    and ends when the position returns to zero.

    Args:
        fills: List of fill dicts from Hyperliquid API, sorted by time.

    Returns:
        List of trade dicts.
    """
    sorted_fills = sorted(fills, key=lambda f: f["time"])

    # Group fills by coin
    by_coin = {}
    for f in sorted_fills:
        coin = f["coin"]
        if coin not in by_coin:
            by_coin[coin] = []
        by_coin[coin].append(f)

    trades = []
    for coin, coin_fills in by_coin.items():
        trades.extend(_process_coin_fills(coin, coin_fills))

    # Sort all trades by open time
    trades.sort(key=lambda t: t["open_time"])
    return trades


def _process_coin_fills(coin, fills):
    """Process fills for a single coin into trades."""
    trades = []
    current = None  # Current open trade being built

    for f in fills:
        px = float(f["px"])
        sz = float(f["sz"])
        fee = float(f.get("fee", 0))
        closed_pnl = float(f.get("closedPnl", 0))
        start_pos = float(f.get("startPosition", 0))
        direction = f.get("dir", "")
        tid = f.get("tid", f.get("oid", 0))

        is_open = direction.startswith("Open")
        is_close = direction.startswith("Close")

        # Compute end position after this fill
        signed_sz = sz if f["side"] == "B" else -sz
        end_pos = start_pos + signed_sz

        # --- Handle opening fills ---
        if is_open:
            if current is None:
                # Start a new trade
                current = _new_trade(coin, f, px, sz, fee, tid)
            else:
                # Scaling into existing position
                current["entry_value"] += px * sz
                current["entry_size"] += sz
                current["fees"] += fee
                current["fill_ids"].append(tid)
                current["max_px"] = max(current["max_px"], px)
                current["min_px"] = min(current["min_px"], px)

        # --- Handle closing fills ---
        if is_close:
            if current is None:
                # Orphan close — position existed before our fill history.
                # Create a synthetic trade from this close alone.
                current = _new_trade(coin, f, px, sz, fee, tid)
                # Mark as orphan: we don't know the true entry
                current["orphan"] = True
                current["realized_pnl"] += closed_pnl
            else:
                current["realized_pnl"] += closed_pnl
                current["fees"] += fee
                current["fill_ids"].append(tid)
                current["max_px"] = max(current["max_px"], px)
                current["min_px"] = min(current["min_px"], px)
                current["exit_value"] += px * sz
                current["exit_size"] += sz
                current["last_px"] = px
                current["last_time"] = f["time"]

            # Check if position is now flat (trade complete)
            if abs(end_pos) < 1e-9:
                trade = _finalize_trade(current)
                if trade is not None:
                    trades.append(trade)
                current = None

            # Handle position flip (e.g., long → short in one fill)
            # This shouldn't happen with proper dir fields but handle defensively
            elif is_close and current and not current.get("orphan"):
                # Position reduced but not closed — partial close, keep going
                pass

        # --- Edge case: fill is both opening and closing (flip) ---
        # The API should split these into separate fills, but handle just in case
        if not is_open and not is_close:
            # Unknown dir — use position math as fallback
            if current is None and abs(end_pos) > 1e-9:
                current = _new_trade(coin, f, px, sz, fee, tid)
            elif current is not None:
                current["fees"] += fee
                current["fill_ids"].append(tid)
                if closed_pnl != 0:
                    current["realized_pnl"] += closed_pnl
                    current["exit_value"] += px * sz
                    current["exit_size"] += sz
                current["max_px"] = max(current["max_px"], px)
                current["min_px"] = min(current["min_px"], px)
                current["last_px"] = px
                current["last_time"] = f["time"]
                if abs(end_pos) < 1e-9:
                    trade = _finalize_trade(current)
                    if trade is not None:
                        trades.append(trade)
                    current = None

    # Don't include still-open trades (no close yet)
    # Could optionally include them marked as "open" in the future

    return trades


def _new_trade(coin, fill, px, sz, fee, tid):
    """Create a new trade accumulator from an opening fill."""
    return {
        "coin": coin,
        "side": "B" if fill["side"] == "B" else "A",
        "entry_value": px * sz,
        "entry_size": sz,
        "realized_pnl": 0.0,
        "fees": fee,
        "open_time": fill["time"],
        "last_time": fill["time"],
        "last_px": px,
        "max_px": px,
        "min_px": px,
        "exit_value": 0.0,
        "exit_size": 0.0,
        "fill_ids": [tid],
        "orphan": False,
    }


def _finalize_trade(t):
    """Convert a trade accumulator into a final trade dict."""
    if t is None:
        return None

    avg_entry = t["entry_value"] / t["entry_size"] if t["entry_size"] > 0 else t["last_px"]
    exit_px = t["exit_value"] / t["exit_size"] if t["exit_size"] > 0 else t["last_px"]
    is_long = t["side"] == "B"

    # MAE: max adverse excursion (worst price vs entry)
    # For longs: how far price dropped below entry
    # For shorts: how far price rose above entry
    if avg_entry > 0:
        mae_px = t["min_px"] if is_long else t["max_px"]
        mfe_px = t["max_px"] if is_long else t["min_px"]
        mae = abs(mae_px - avg_entry) / avg_entry
        mfe = abs(mfe_px - avg_entry) / avg_entry
    else:
        mae = 0
        mfe = 0

    pnl = t["realized_pnl"]

    # Skip trades with zero PnL AND zero fees (true data artifacts)
    if abs(pnl) < 1e-9 and abs(t["fees"]) < 1e-9 and not t["orphan"]:
        return None

    return {
        "coin": t["coin"],
        "side": t["side"],
        "entry_px": round(avg_entry, 8),
        "exit_px": round(exit_px, 8),
        "size": round(t["entry_size"], 8),
        "pnl": round(pnl, 6),
        "fees": round(t["fees"], 6),
        "open_time": t["open_time"],
        "close_time": t["last_time"],
        "hold_ms": t["last_time"] - t["open_time"],
        "mae": round(mae, 6),
        "mfe": round(mfe, 6),
        "fill_ids": json.dumps(t["fill_ids"]),
    }


def enrich_trades_with_candles(trades, candle_fetcher):
    """Enrich MFE/MAE using actual candle highs/lows instead of fill prices only.

    Fetches 1-minute candles per coin (one API call per coin) and updates
    each trade's mae/mfe to reflect the true market extremes during the trade.

    Args:
        trades: List of finalized trade dicts from process_fills_to_trades().
        candle_fetcher: Callable(coin, interval, start_time, end_time) -> list of candle dicts.

    Returns:
        The same trades list with mae/mfe updated in place.
    """
    if not trades:
        return trades

    # Group trades by coin
    by_coin = {}
    for t in trades:
        coin = t["coin"]
        if coin not in by_coin:
            by_coin[coin] = []
        by_coin[coin].append(t)

    for coin, coin_trades in by_coin.items():
        # Find the full time range for this coin
        min_time = min(t["open_time"] for t in coin_trades)
        max_time = max(t["close_time"] for t in coin_trades)

        try:
            candles = candle_fetcher(coin, "1m", min_time, max_time)
        except Exception as e:
            print(f"[ENRICH] Failed to fetch candles for {coin}: {e}")
            continue

        if not candles:
            continue

        # Parse candles into (start_time, high, low) tuples, sorted by time
        parsed = []
        for c in candles:
            try:
                ct = int(c["t"])
                ch = float(c["h"])
                cl = float(c["l"])
                parsed.append((ct, ch, cl))
            except (KeyError, ValueError):
                continue

        if not parsed:
            continue

        parsed.sort(key=lambda x: x[0])

        # For each trade, find candles within its time window and update MFE/MAE
        for t in coin_trades:
            entry_px = t["entry_px"]
            if entry_px <= 0:
                continue

            is_long = t["side"] == "B"
            open_time = t["open_time"]
            close_time = t["close_time"]

            # Filter candles to this trade's window
            trade_high = 0.0
            trade_low = float("inf")
            found = False
            for ct, ch, cl in parsed:
                # 1m candle at time ct covers [ct, ct+60000)
                # Include candle if it overlaps with the trade window
                if ct + 60000 < open_time:
                    continue
                if ct > close_time:
                    break
                trade_high = max(trade_high, ch)
                trade_low = min(trade_low, cl)
                found = True

            if not found:
                continue

            # Compute updated MFE/MAE from candle extremes
            if is_long:
                mfe_px = trade_high
                mae_px = trade_low
            else:
                mfe_px = trade_low
                mae_px = trade_high

            t["mfe"] = round(abs(mfe_px - entry_px) / entry_px, 6)
            t["mae"] = round(abs(mae_px - entry_px) / entry_px, 6)

    return trades
