"""Tests for trade_processor.process_fills_to_trades — focus on position flips."""

import json
import pytest
from trade_processor import process_fills_to_trades


def _make_fill(tid, coin, side, direction, px, sz, time_ms,
               start_position, closed_pnl=0.0, fee=0.5):
    """Helper to build a fill dict matching the Hyperliquid API shape."""
    return {
        "tid": tid,
        "coin": coin,
        "side": side,
        "dir": direction,
        "px": str(px),
        "sz": str(sz),
        "time": time_ms,
        "startPosition": str(start_position),
        "closedPnl": str(closed_pnl),
        "fee": str(fee),
        "oid": tid,
        "hash": f"0x{tid:064x}",
    }


# ─── Normal round-trip (no flip) ────────────────────────────────────────────

class TestNormalRoundTrip:
    def test_simple_long(self):
        """Open Long → Close Long produces one trade."""
        fills = [
            _make_fill(1, "BTC", "B", "Open Long", 100, 10, 1000, 0),
            _make_fill(2, "BTC", "A", "Close Long", 110, 10, 2000, 10, closed_pnl=100),
        ]
        trades = process_fills_to_trades(fills)
        assert len(trades) == 1
        t = trades[0]
        assert t["side"] == "B"
        assert t["coin"] == "BTC"
        assert t["pnl"] == 100
        assert t["entry_px"] == 100
        assert t["exit_px"] == 110

    def test_simple_short(self):
        """Open Short → Close Short produces one trade."""
        fills = [
            _make_fill(1, "ETH", "A", "Open Short", 200, 5, 1000, 0),
            _make_fill(2, "ETH", "B", "Close Short", 190, 5, 2000, -5, closed_pnl=50),
        ]
        trades = process_fills_to_trades(fills)
        assert len(trades) == 1
        t = trades[0]
        assert t["side"] == "A"
        assert t["pnl"] == 50

    def test_scale_in_long(self):
        """Scaling into a long position then closing produces one trade."""
        fills = [
            _make_fill(1, "BTC", "B", "Open Long", 100, 5, 1000, 0),
            _make_fill(2, "BTC", "B", "Open Long", 105, 5, 1500, 5),
            _make_fill(3, "BTC", "A", "Close Long", 110, 10, 2000, 10, closed_pnl=75),
        ]
        trades = process_fills_to_trades(fills)
        assert len(trades) == 1
        t = trades[0]
        assert t["side"] == "B"
        assert t["size"] == 10
        # Entry px = (100*5 + 105*5) / 10 = 102.5
        assert t["entry_px"] == 102.5


# ─── Position flip: Short → Long ────────────────────────────────────────────

class TestShortToLongFlip:
    def test_flip_produces_two_trades(self):
        """Oversized buy that flips short→long should produce two separate trades."""
        fills = [
            # Open short: sell 10 @ 100, position goes to -10
            _make_fill(1, "BTC", "A", "Open Short", 100, 10, 1000, 0),
            # TP buy 15 @ 95: closes short (10) + opens long (5)
            # The API labels this "Close Short" with the full 15 size
            # startPosition=-10, after fill position = -10 + 15 = 5
            _make_fill(2, "BTC", "B", "Close Short", 95, 15, 2000, -10, closed_pnl=50, fee=1.0),
            # Close the long: sell 5 @ 105
            _make_fill(3, "BTC", "A", "Close Long", 105, 5, 3000, 5, closed_pnl=50),
        ]
        trades = process_fills_to_trades(fills)

        assert len(trades) == 2

        # First trade: the short
        short_trade = trades[0]
        assert short_trade["side"] == "A"
        assert short_trade["coin"] == "BTC"
        assert short_trade["entry_px"] == 100
        assert short_trade["exit_px"] == 95
        assert short_trade["size"] == 10
        assert short_trade["pnl"] == 50

        # Second trade: the long (from the flip)
        long_trade = trades[1]
        assert long_trade["side"] == "B"
        assert long_trade["coin"] == "BTC"
        assert long_trade["entry_px"] == 95
        assert long_trade["exit_px"] == 105
        assert long_trade["size"] == 5
        assert long_trade["pnl"] == 50

    def test_flip_fee_split(self):
        """Fee from the flip fill should be split proportionally."""
        fills = [
            _make_fill(1, "BTC", "A", "Open Short", 100, 10, 1000, 0, fee=0.5),
            # Flip fill: 15 units total, fee=1.5
            # close_sz=10, open_sz=5, fee_ratio=10/15=2/3
            # close fee = 1.5 * 2/3 = 1.0, open fee = 1.5 * 1/3 = 0.5
            _make_fill(2, "BTC", "B", "Close Short", 95, 15, 2000, -10, closed_pnl=50, fee=1.5),
            _make_fill(3, "BTC", "A", "Close Long", 105, 5, 3000, 5, closed_pnl=50, fee=0.5),
        ]
        trades = process_fills_to_trades(fills)
        assert len(trades) == 2

        # Short trade fees: 0.5 (open) + 1.0 (close portion) = 1.5
        assert abs(trades[0]["fees"] - 1.5) < 1e-6
        # Long trade fees: 0.5 (open portion) + 0.5 (close) = 1.0
        assert abs(trades[1]["fees"] - 1.0) < 1e-6


# ─── Position flip: Long → Short ────────────────────────────────────────────

class TestLongToShortFlip:
    def test_flip_produces_two_trades(self):
        """Oversized sell that flips long→short should produce two separate trades."""
        fills = [
            # Open long: buy 10 @ 100, position goes to 10
            _make_fill(1, "BTC", "B", "Open Long", 100, 10, 1000, 0),
            # Sell 15 @ 110: closes long (10) + opens short (5)
            # startPosition=10, after fill position = 10 - 15 = -5
            _make_fill(2, "BTC", "A", "Close Long", 110, 15, 2000, 10, closed_pnl=100, fee=1.5),
            # Close the short: buy 5 @ 105
            _make_fill(3, "BTC", "B", "Close Short", 105, 5, 3000, -5, closed_pnl=25),
        ]
        trades = process_fills_to_trades(fills)

        assert len(trades) == 2

        # First trade: the long
        long_trade = trades[0]
        assert long_trade["side"] == "B"
        assert long_trade["entry_px"] == 100
        assert long_trade["exit_px"] == 110
        assert long_trade["size"] == 10
        assert long_trade["pnl"] == 100

        # Second trade: the short (from the flip)
        short_trade = trades[1]
        assert short_trade["side"] == "A"
        assert short_trade["entry_px"] == 110
        assert short_trade["exit_px"] == 105
        assert short_trade["size"] == 5
        assert short_trade["pnl"] == 25

    def test_flip_fee_split(self):
        """Fee from the flip fill should be split proportionally (long→short)."""
        fills = [
            _make_fill(1, "BTC", "B", "Open Long", 100, 10, 1000, 0, fee=0.5),
            # Flip fill: 15 units, fee=3.0
            # close_sz=10, open_sz=5, fee_ratio=10/15=2/3
            # close fee = 3.0 * 2/3 = 2.0, open fee = 3.0 * 1/3 = 1.0
            _make_fill(2, "BTC", "A", "Close Long", 110, 15, 2000, 10, closed_pnl=100, fee=3.0),
            _make_fill(3, "BTC", "B", "Close Short", 105, 5, 3000, -5, closed_pnl=25, fee=0.5),
        ]
        trades = process_fills_to_trades(fills)
        assert len(trades) == 2

        # Long trade fees: 0.5 (open) + 2.0 (close portion) = 2.5
        assert abs(trades[0]["fees"] - 2.5) < 1e-6
        # Short trade fees: 1.0 (open portion) + 0.5 (close) = 1.5
        assert abs(trades[1]["fees"] - 1.5) < 1e-6


# ─── Edge cases ──────────────────────────────────────────────────────────────

class TestEdgeCases:
    def test_flip_with_equal_size_is_flat(self):
        """A close fill that exactly matches position size should NOT flip."""
        fills = [
            _make_fill(1, "BTC", "A", "Open Short", 100, 10, 1000, 0),
            _make_fill(2, "BTC", "B", "Close Short", 95, 10, 2000, -10, closed_pnl=50),
        ]
        trades = process_fills_to_trades(fills)
        assert len(trades) == 1
        assert trades[0]["side"] == "A"
        assert trades[0]["pnl"] == 50

    def test_multiple_coins_independent(self):
        """Flips on one coin don't affect trades on another coin."""
        fills = [
            # BTC: normal round-trip
            _make_fill(1, "BTC", "B", "Open Long", 100, 5, 1000, 0),
            _make_fill(2, "BTC", "A", "Close Long", 110, 5, 2000, 5, closed_pnl=50),
            # ETH: flip short→long
            _make_fill(3, "ETH", "A", "Open Short", 200, 10, 1500, 0),
            _make_fill(4, "ETH", "B", "Close Short", 190, 15, 2500, -10, closed_pnl=100, fee=1.0),
            _make_fill(5, "ETH", "A", "Close Long", 210, 5, 3500, 5, closed_pnl=100),
        ]
        trades = process_fills_to_trades(fills)
        # BTC: 1 trade, ETH: 2 trades (short + long from flip)
        assert len(trades) == 3

        btc_trades = [t for t in trades if t["coin"] == "BTC"]
        eth_trades = [t for t in trades if t["coin"] == "ETH"]
        assert len(btc_trades) == 1
        assert len(eth_trades) == 2

    def test_flip_fill_id_in_both_trades(self):
        """The flip fill's tid should appear in both trades' fill_ids."""
        fills = [
            _make_fill(1, "BTC", "A", "Open Short", 100, 10, 1000, 0),
            _make_fill(2, "BTC", "B", "Close Short", 95, 15, 2000, -10, closed_pnl=50),
            _make_fill(3, "BTC", "A", "Close Long", 105, 5, 3000, 5, closed_pnl=50),
        ]
        trades = process_fills_to_trades(fills)
        assert len(trades) == 2

        short_fill_ids = json.loads(trades[0]["fill_ids"])
        long_fill_ids = json.loads(trades[1]["fill_ids"])

        # Fill tid=2 (the flip) should be in the short trade's fill_ids
        assert 2 in short_fill_ids
        # Fill tid=2 should also be in the long trade's fill_ids
        assert 2 in long_fill_ids


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
