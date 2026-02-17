import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DB_PATH = os.path.join(BASE_DIR, "trading_journal.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")

HL_API_URL = "https://api.hyperliquid.xyz/info"
HL_FILLS_PER_PAGE = 2000

DEFAULT_WALLET = "0x2f19224117b6ec59f9D85E2792871cECBecD7a97"
