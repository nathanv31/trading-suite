# Trading Journal App — Implementation Plan

## Architecture Overview

```
trading-suite/
├── backend/           # Python/Flask API + SQLite
│   ├── app.py         # Flask entry, CORS, routes
│   ├── config.py      # Config (DB path, API URLs)
│   ├── db.py          # SQLite setup + schema
│   ├── hl_client.py   # Hyperliquid REST API client
│   ├── trade_processor.py  # Fill → grouped trade logic
│   ├── routes/
│   │   ├── trades.py       # GET /api/trades, GET /api/fills
│   │   ├── journal.py      # CRUD notes, tags, screenshots
│   │   └── calendar.py     # CRUD day notes, week reviews
│   └── requirements.txt
├── frontend/          # React + TypeScript + Vite
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── index.css         # All CSS variables + custom styles from original
│   │   ├── types.ts          # Shared TypeScript types
│   │   ├── api/client.ts     # Fetch wrapper for backend
│   │   ├── context/TradeContext.tsx  # Global trade data provider
│   │   ├── utils/
│   │   │   ├── formatters.ts       # formatHold, currency, dates
│   │   │   └── tradeStats.ts       # Analytics computations (client-side)
│   │   ├── pages/
│   │   │   ├── HomePage.tsx
│   │   │   ├── AnalyticsPage.tsx
│   │   │   ├── CalendarPage.tsx
│   │   │   └── JournalPage.tsx
│   │   └── components/
│   │       ├── Layout/Sidebar.tsx, Header.tsx
│   │       ├── Home/MetricCards.tsx, PnlChart.tsx, RecentTrades.tsx
│   │       ├── Analytics/StatCards.tsx, ModuleGrid.tsx, charts/*.tsx
│   │       ├── Calendar/CalendarGrid.tsx, DaySidebar.tsx, WeekPanel.tsx
│   │       ├── Journal/JournalFilters.tsx, JournalRow.tsx, TradeDetail.tsx, DatePicker.tsx
│   │       └── shared/PnlBadge.tsx, CoinBadge.tsx, FilterSelect.tsx
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── tsconfig.json
└── .gitignore
```

**Key decisions:**
- **Analytics computed client-side** — dataset is small (<10k trades), keeps backend simple
- **Backend = API + persistence** — fetches/caches fills, groups into trades, stores notes/tags/screenshots
- **SQLite** — no setup, single file, perfect for local-only app
- **Direct REST API** for Hyperliquid (no SDK) — lightweight, `userFillsByTime` with `aggregateByTime: true`

---

## Phase 1: Project Scaffolding + Backend Core

### Step 1.1 — Initialize project structure
- Create `.gitignore` (node_modules, __pycache__, .venv, *.db, uploads/)
- Create `backend/requirements.txt`: flask, flask-cors, requests
- Create `backend/config.py`: DB path, API URL, upload dir, default wallet
- Create `backend/db.py`: SQLite schema initialization

**Database schema:**
```sql
-- Cached fills from Hyperliquid (avoid re-fetching)
CREATE TABLE fills (
    tid INTEGER PRIMARY KEY,       -- Hyperliquid trade ID
    coin TEXT NOT NULL,
    px TEXT NOT NULL,
    sz TEXT NOT NULL,
    side TEXT NOT NULL,             -- 'B' or 'A'
    dir TEXT NOT NULL,              -- 'Open Long', 'Close Long', etc.
    time INTEGER NOT NULL,
    start_position TEXT NOT NULL,
    closed_pnl TEXT NOT NULL,
    fee TEXT NOT NULL,
    oid INTEGER NOT NULL,
    hash TEXT,
    crossed INTEGER,
    wallet TEXT NOT NULL
);

-- Grouped round-trip trades (computed from fills)
CREATE TABLE trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT NOT NULL,
    coin TEXT NOT NULL,
    side TEXT NOT NULL,             -- 'B' (long) or 'A' (short)
    entry_px REAL NOT NULL,
    exit_px REAL,
    size REAL NOT NULL,
    pnl REAL NOT NULL,
    fees REAL NOT NULL,
    open_time INTEGER NOT NULL,
    close_time INTEGER,
    hold_ms INTEGER,
    mae REAL,                      -- max adverse excursion %
    mfe REAL,                      -- max favorable excursion %
    fill_ids TEXT NOT NULL          -- JSON array of tid values
);

-- Journal: notes per trade
CREATE TABLE trade_notes (
    trade_id INTEGER PRIMARY KEY REFERENCES trades(id),
    notes TEXT DEFAULT '',
    updated_at INTEGER
);

-- Journal: tags per trade
CREATE TABLE trade_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id INTEGER NOT NULL REFERENCES trades(id),
    tag TEXT NOT NULL,
    UNIQUE(trade_id, tag)
);

-- Journal: screenshots per trade
CREATE TABLE trade_screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id INTEGER NOT NULL REFERENCES trades(id),
    filename TEXT NOT NULL,
    original_name TEXT,
    uploaded_at INTEGER
);

-- Calendar: daily notes
CREATE TABLE calendar_notes (
    date_key TEXT PRIMARY KEY,     -- 'YYYY-MM-DD'
    notes TEXT DEFAULT '',
    updated_at INTEGER
);

-- Calendar: weekly review notes
CREATE TABLE week_notes (
    week_key TEXT PRIMARY KEY,     -- 'YYYY-MM-DD' of Monday
    review TEXT DEFAULT '',
    well TEXT DEFAULT '',
    improve TEXT DEFAULT '',
    updated_at INTEGER
);
```

### Step 1.2 — Hyperliquid REST client (`hl_client.py`)
- `fetch_fills(wallet, start_time, end_time)` — POST to API with `userFillsByTime`, `aggregateByTime: true`
- `fetch_all_fills(wallet)` — paginate through all history using time windows (2000 fills per response)
- `fetch_user_state(wallet)` — get current positions via `clearinghouseState`
- Handle rate limiting, retries with exponential backoff

### Step 1.3 — Trade processor (`trade_processor.py`)
The critical logic that replaces Sonnet's buggy JS implementation.

**Algorithm using `dir` field:**
```
Sort fills by time ascending, group by coin.
For each coin's fills:
    current_trade = None
    for fill in fills:
        if fill.dir starts with "Open":
            if current_trade is None:
                current_trade = new trade (record open time, side, etc.)
            # Add to position (scaling in)
            current_trade.entry_value += fill.px * fill.sz
            current_trade.entry_size += fill.sz
            Track max/min price for MAE/MFE

        if fill.dir starts with "Close":
            if current_trade is None: skip (orphan close)
            current_trade.realized_pnl += fill.closedPnl
            current_trade.fees += fill.fee
            Track max/min price for MAE/MFE

            # Check if position is now flat
            new_position = float(fill.startPosition) + (fill.sz if fill.side == 'B' else -fill.sz)
            if abs(new_position) < 1e-9:
                Finalize trade: compute avg entry, exit, hold time, MAE, MFE
                Save to trades list
                current_trade = None
```

**Key improvements over Sonnet's approach:**
- Uses `dir` field instead of inferring from position math
- Properly handles scaling in/out
- Uses `closedPnl` directly from the API (no manual PnL calculation)
- Handles position flips (long→short) by closing one trade and opening another
- Handles orphan fills (closes without matching opens from before our history)

### Step 1.4 — Flask app + trade routes
- `GET /api/trades?wallet=0x...` — returns grouped trades (fetches + processes if not cached)
- `GET /api/trades/refresh?wallet=0x...` — force re-fetch from Hyperliquid
- `GET /api/state?wallet=0x...` — current positions/account state

---

## Phase 2: Journal + Calendar API Routes

### Step 2.1 — Journal routes (`routes/journal.py`)
- `GET /api/trades/:id/notes` — get notes for a trade
- `PUT /api/trades/:id/notes` — save/update notes
- `GET /api/trades/:id/tags` — get tags for a trade
- `POST /api/trades/:id/tags` — add a tag
- `DELETE /api/trades/:id/tags/:tag` — remove a tag
- `POST /api/trades/:id/screenshots` — upload screenshot (multipart)
- `GET /api/trades/:id/screenshots` — list screenshots
- `GET /api/screenshots/:filename` — serve screenshot file
- `DELETE /api/screenshots/:id` — delete screenshot

### Step 2.2 — Calendar routes (`routes/calendar.py`)
- `GET /api/calendar/notes/:dateKey` — get day note
- `PUT /api/calendar/notes/:dateKey` — save day note
- `GET /api/calendar/week/:weekKey` — get week review
- `PUT /api/calendar/week/:weekKey` — save week review

### Step 2.3 — Wire up Flask app
- Register all route blueprints
- CORS configuration for local dev
- Static file serving for screenshots
- Error handling middleware

---

## Phase 3: Frontend Scaffolding

### Step 3.1 — Vite + React + TypeScript setup
```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install react-router-dom chart.js react-chartjs-2 chartjs-adapter-luxon luxon
npm install -D tailwindcss @tailwindcss/vite
```
- Configure Vite proxy to Flask backend (port 5000)
- Configure Tailwind with the dark theme color palette
- Port ALL CSS from the original HTML into `index.css` (variables, component styles)

### Step 3.2 — Types + API client
- `types.ts`: Trade, Fill, TradeNote, CalendarNote, WeekNote interfaces
- `api/client.ts`: typed fetch wrapper for all backend endpoints

### Step 3.3 — TradeContext + Layout
- `TradeContext.tsx`: fetches trades on mount, provides to entire app
- `Layout/Sidebar.tsx`: port sidebar nav (collapsible, icons, nav items)
- `Layout/Header.tsx`: port header bar
- `App.tsx`: React Router with 4 routes (home, analytics, calendar, journal)

---

## Phase 4: Home Page

### Step 4.1 — Port Home page components
- `MetricCards.tsx`: Portfolio value, win rate donut, trade count, long/short ratio
- `PnlChart.tsx`: Cumulative PnL line chart (Chart.js)
- `RecentTrades.tsx`: Last 3 trades with details
- All using data from TradeContext

---

## Phase 5: Journal Page

### Step 5.1 — Journal filters + list
- `JournalFilters.tsx`: date picker, side, result, coin, sort, tag filter
- `DatePicker.tsx`: full date range picker (port the dual-calendar dropdown)
- `JournalRow.tsx`: expandable trade row with all columns
- Pagination controls

### Step 5.2 — Trade detail panel
- `TradeDetail.tsx`: expanded view with stats table, notes textarea, tags, screenshots
- Notes auto-save to backend (debounced)
- Tag add/remove via backend
- Screenshot upload/display/delete via backend

---

## Phase 6: Calendar Page

### Step 6.1 — Calendar grid
- `CalendarGrid.tsx`: monthly grid with week tabs, PnL per day, trade counts
- `DaySidebar.tsx`: day detail with summary, notes, trade list
- `WeekPanel.tsx`: weekly review with stats, day breakdown, notes fields

### Step 6.2 — Navigation integration
- "View in Journal" buttons that set date filters and navigate
- Month/year navigation, "Today" button

---

## Phase 7: Analytics Page

### Step 7.1 — Stat cards + filters
- `StatCards.tsx`: 10 key metric cards (net PnL, win rate, profit factor, etc.)
- Filter bar: date picker, side, result, coin, tag filters (independent from journal)

### Step 7.2 — Chart modules
Port all 11 chart modules as individual components:
- `EquityChart.tsx` (cumulative P&L line)
- `DrawdownChart.tsx` (drawdown % line)
- `DayOfWeekChart.tsx` (bar)
- `TimeOfDayChart.tsx` (bar)
- `HoldTimeChart.tsx` (bar)
- `CoinChart.tsx` (bar)
- `LongShortChart.tsx` (doughnut)
- `DistributionChart.tsx` (histogram)
- `StreakChart.tsx` (bar)
- `MaeMfeChart.tsx` (scatter)
- `StatsTable.tsx` (full statistics grid)

### Step 7.3 — Module grid with drag-and-drop
- `ModuleGrid.tsx`: draggable, hideable modules
- Layout persistence in localStorage
- Hidden module chips bar

---

## Phase 8: Screenshots + Price Chart (New Features)

### Step 8.1 — Screenshot upload in trade detail
- Drag & drop or click-to-upload in TradeDetail
- Image preview with delete button
- Stored on disk, served by Flask

### Step 8.2 — Price action chart with entry/exit bubbles
- Fetch candle data: `candleSnapshot` endpoint from Hyperliquid API
- New backend endpoint: `GET /api/candles?coin=BTC&interval=5m&start=...&end=...`
- New component: `PriceChart.tsx` in trade detail panel
- Candlestick chart (Chart.js financial plugin or lightweight-charts)
- Overlay entry/exit markers as colored bubbles
- Dynamic average entry/exit horizontal lines
- Time range: trade open - 10% padding to trade close + 10% padding

---

## Execution Order

1. **Phase 1** — Backend core (scaffolding, DB, API client, trade processor)
2. **Phase 2** — Backend journal/calendar routes
3. **Phase 3** — Frontend scaffolding (Vite, routing, context, layout)
4. **Phase 4** — Home page
5. **Phase 5** — Journal page
6. **Phase 6** — Calendar page
7. **Phase 7** — Analytics page
8. **Phase 8** — New features (screenshots, price chart)

Each phase produces a working, testable increment.
