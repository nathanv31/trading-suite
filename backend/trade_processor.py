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
