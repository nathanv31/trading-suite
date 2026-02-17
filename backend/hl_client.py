"""Hyperliquid REST API client — read-only info endpoints."""

import time
import requests
from config import HL_API_URL, HL_FILLS_PER_PAGE


class HyperliquidClient:
    def __init__(self, api_url=HL_API_URL):
        self.api_url = api_url
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})

    def _post(self, payload, retries=3):
        """POST to the info endpoint with retry logic."""
        for attempt in range(retries):
            try:
                resp = self.session.post(self.api_url, json=payload, timeout=30)
                resp.raise_for_status()
                return resp.json()
            except (requests.RequestException, ValueError) as e:
                if attempt == retries - 1:
                    raise
                wait = 2 ** (attempt + 1)
                print(f"[HL] Request failed ({e}), retrying in {wait}s...")
                time.sleep(wait)

    def fetch_fills_by_time(self, wallet, start_time, end_time=None, aggregate=True):
        """Fetch fills for a wallet in a time range.

        Args:
            wallet: Ethereum address
            start_time: Start timestamp in ms (inclusive)
            end_time: End timestamp in ms (inclusive), defaults to now
            aggregate: Combine partial fills from same crossing order

        Returns:
            List of fill dicts
        """
        payload = {
            "type": "userFillsByTime",
            "user": wallet,
            "startTime": start_time,
            "aggregateByTime": aggregate,
        }
        if end_time is not None:
            payload["endTime"] = end_time
        result = self._post(payload)
        return result if isinstance(result, list) else []

    def fetch_all_fills(self, wallet):
        """Fetch all historical fills by paginating through time windows.

        The API returns at most 2000 fills per request.
        We paginate by using the last fill's timestamp as the next start_time.
        """
        all_fills = []
        # Start from the beginning of Hyperliquid (Nov 2022)
        start_time = 1667260800000  # 2022-11-01T00:00:00Z

        while True:
            fills = self.fetch_fills_by_time(wallet, start_time)
            if not fills:
                break

            all_fills.extend(fills)
            print(f"[HL] Fetched {len(fills)} fills (total: {len(all_fills)})")

            if len(fills) < HL_FILLS_PER_PAGE:
                # Got less than a full page — we're done
                break

            # Next page starts after the last fill's timestamp
            last_time = max(f["time"] for f in fills)
            start_time = last_time + 1

            # Rate limit courtesy
            time.sleep(0.5)

        return all_fills

    def fetch_user_state(self, wallet):
        """Get current positions and account state."""
        payload = {
            "type": "clearinghouseState",
            "user": wallet,
        }
        return self._post(payload)

    def fetch_candles(self, coin, interval, start_time, end_time):
        """Fetch candlestick data for price charts.

        Args:
            coin: Trading symbol (e.g., "BTC")
            interval: Candle interval (e.g., "5m", "1h", "1d")
            start_time: Start timestamp in ms
            end_time: End timestamp in ms
        """
        payload = {
            "type": "candleSnapshot",
            "req": {
                "coin": coin,
                "interval": interval,
                "startTime": start_time,
                "endTime": end_time,
            },
        }
        return self._post(payload)
