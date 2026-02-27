"""Background MFE/MAE enrichment using candle data.

Runs candle fetching in a background thread so trade refresh returns instantly.
Caches candle data in SQLite to avoid re-fetching on subsequent refreshes.
"""

import threading
import time as _time
from db import get_db
from trade_processor import parse_candles, extract_high_low


class _EnrichmentJob:
    """Tracks a single background enrichment run."""

    def __init__(self):
        self.cancel = threading.Event()
        self.status = "running"  # running | completed | failed
        self.progress = 0
        self.total = 0
        self.error = None


class EnrichmentManager:
    """Manages background enrichment threads, one per wallet."""

    def __init__(self):
        self._jobs = {}  # wallet -> _EnrichmentJob
        self._lock = threading.Lock()

    def start_enrichment(self, wallet, trades, candle_fetcher):
        """Start background candle enrichment for a wallet's trades.

        Cancels any existing enrichment for this wallet first.
        """
        with self._lock:
            old = self._jobs.get(wallet)
            if old and old.status == "running":
                old.cancel.set()

            job = _EnrichmentJob()
            self._jobs[wallet] = job

        thread = threading.Thread(
            target=self._run,
            args=(wallet, trades, candle_fetcher, job),
            daemon=True,
        )
        thread.start()

    def get_status(self, wallet):
        """Get enrichment status for a wallet."""
        with self._lock:
            job = self._jobs.get(wallet)
        if not job:
            return {"status": "idle", "progress": 0, "total": 0}
        return {
            "status": job.status,
            "progress": job.progress,
            "total": job.total,
        }

    def _run(self, wallet, trades, candle_fetcher, job):
        """Background thread: enrich trades with candle data."""
        t0 = _time.time()
        try:
            self._enrich(wallet, trades, candle_fetcher, job)
            if not job.cancel.is_set():
                job.status = "completed"
                elapsed = _time.time() - t0
                print(f"[ENRICH] Completed enrichment for {wallet} "
                      f"({job.progress}/{job.total} batches, {elapsed:.1f}s)")
        except Exception as e:
            job.status = "failed"
            job.error = str(e)
            print(f"[ENRICH] Failed for {wallet}: {e}")

    def _enrich(self, wallet, trades, candle_fetcher, job):
        """Core enrichment logic with candle caching.

        Uses a single DB connection for the entire run to avoid
        per-batch connection overhead (3 PRAGMAs per get_db() call).
        """
        if not trades:
            return

        # Group trades by coin
        by_coin = {}
        for t in trades:
            coin = t["coin"]
            if coin not in by_coin:
                by_coin[coin] = []
            by_coin[coin].append(t)

        max_batch_ms = 500 * 60 * 1000  # 500 minutes

        # Build all batches first to set total count
        all_batches = []
        for coin, coin_trades in by_coin.items():
            coin_trades.sort(key=lambda t: t["open_time"])

            batch_start = coin_trades[0]["open_time"]
            batch = [coin_trades[0]]

            for t in coin_trades[1:]:
                if t["close_time"] - batch_start <= max_batch_ms:
                    batch.append(t)
                else:
                    all_batches.append((coin, batch_start, batch[-1]["close_time"], batch))
                    batch_start = t["open_time"]
                    batch = [t]
            all_batches.append((coin, batch_start, batch[-1]["close_time"], batch))

        job.total = len(all_batches)

        # Single DB connection for the entire enrichment run
        conn = get_db()
        try:
            all_updates = []

            for coin, b_start, b_end, batch_trades in all_batches:
                if job.cancel.is_set():
                    print(f"[ENRICH] Cancelled for {wallet}")
                    return

                try:
                    parsed = self._get_candles(
                        conn, coin, b_start, b_end, candle_fetcher
                    )
                except Exception as e:
                    print(f"[ENRICH] Failed to get candles for {coin}: {e}")
                    job.progress += 1
                    continue

                if not parsed:
                    job.progress += 1
                    continue

                # Compute enriched MAE/MFE for each trade in this batch
                for t in batch_trades:
                    entry_px = t["entry_px"]
                    if entry_px <= 0:
                        continue

                    trade_high, trade_low, found = extract_high_low(
                        parsed, t["open_time"], t["close_time"]
                    )
                    if not found:
                        continue

                    is_long = t["side"] == "B"
                    if is_long:
                        mfe_px = trade_high
                        mae_px = trade_low
                    else:
                        mfe_px = trade_low
                        mae_px = trade_high

                    new_mfe = round(abs(mfe_px - entry_px) / entry_px, 6)
                    new_mae = round(abs(mae_px - entry_px) / entry_px, 6)
                    all_updates.append((new_mae, new_mfe, t["id"]))

                job.progress += 1

            # Single batch UPDATE + commit for all trades
            if all_updates:
                conn.executemany(
                    "UPDATE trades SET mae = ?, mfe = ? WHERE id = ?",
                    all_updates,
                )
                conn.commit()
        except Exception as e:
            print(f"[ENRICH] DB error: {e}")
            conn.rollback()
            raise
        finally:
            conn.close()

    def _get_candles(self, conn, coin, start, end, candle_fetcher):
        """Get parsed candles for a time range, using cache when possible.

        Returns list of (time, high, low) tuples sorted by time.
        """
        # Check cache first
        rows = conn.execute(
            "SELECT time, high, low FROM candle_cache "
            "WHERE coin = ? AND interval = '1m' AND time >= ? AND time <= ? "
            "ORDER BY time",
            (coin, start, end),
        ).fetchall()

        if rows:
            print(f"[ENRICH] Cache HIT for {coin} ({len(rows)} candles)")
            return [(r["time"], r["high"], r["low"]) for r in rows]

        # Cache miss — fetch from Hyperliquid
        print(f"[ENRICH] Cache MISS for {coin} — fetching from Hyperliquid")
        raw_candles = self._fetch_paginated(candle_fetcher, coin, start, end)
        if not raw_candles:
            return []

        parsed = parse_candles(raw_candles)
        if not parsed:
            return []

        # Store in cache
        cache_rows = [(coin, "1m", t, h, l) for t, h, l in parsed]
        try:
            conn.executemany(
                "INSERT OR IGNORE INTO candle_cache (coin, interval, time, high, low) "
                "VALUES (?, ?, ?, ?, ?)",
                cache_rows,
            )
            conn.commit()
        except Exception as e:
            print(f"[ENRICH] Cache write error for {coin}: {e}")

        return parsed

    def _fetch_paginated(self, candle_fetcher, coin, start, end):
        """Fetch candles with pagination and rate limiting."""
        all_candles = []
        cursor = start
        while cursor < end:
            batch = candle_fetcher(coin, "1m", cursor, end)
            if not batch:
                break
            all_candles.extend(batch)
            if len(batch) < 500:
                break
            cursor = int(batch[-1]["T"])
            # Rate limit between API calls
            _time.sleep(0.15)
        return all_candles


# Singleton instance
enrichment_mgr = EnrichmentManager()
