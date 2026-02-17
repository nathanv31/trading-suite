#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo ""
  echo "Shutting down..."
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null
  wait 2>/dev/null
  echo "Done."
  exit 0
}
trap cleanup INT TERM

# ── Backend setup ──
echo "==> Setting up backend..."
cd "$ROOT/backend"

if [ ! -d "venv" ]; then
  echo "    Creating virtual environment..."
  python3 -m venv venv
fi

source venv/bin/activate
pip install -q -r requirements.txt

echo "==> Starting backend on :5001..."
python app.py &
BACKEND_PID=$!

# ── Frontend setup ──
echo "==> Setting up frontend..."
cd "$ROOT/frontend"

if [ ! -d "node_modules" ]; then
  echo "    Installing npm dependencies..."
  npm install --silent
fi

echo "==> Starting frontend on :3000..."
npm run dev &
FRONTEND_PID=$!

# ── Wait for frontend to be ready, then open browser ──
echo "==> Waiting for app to be ready..."
for i in $(seq 1 30); do
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Open in browser
echo "==> Opening http://localhost:3000"
if command -v xdg-open > /dev/null; then
  xdg-open http://localhost:3000
elif command -v open > /dev/null; then
  open http://localhost:3000
else
  echo "    Open http://localhost:3000 in your browser"
fi

echo ""
echo "HyperAnalytics is running. Press Ctrl+C to stop."
wait
