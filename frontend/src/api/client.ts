import type { Trade, TradeNote, TradeTag, Screenshot, WeekNotes, PnlSummary } from '../types';

const BASE = '/api';

async function fetchJSON<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let message = `API error: ${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // response wasn't JSON, use default message
    }
    throw new Error(message);
  }
  return res.json();
}

// ── Trades ──

export async function getTrades(wallet?: string): Promise<Trade[]> {
  const params = wallet ? `?wallet=${wallet}` : '';
  return fetchJSON<Trade[]>(`${BASE}/trades${params}`);
}

export async function refreshTrades(wallet?: string): Promise<Trade[]> {
  const params = wallet ? `?wallet=${wallet}` : '';
  return fetchJSON<Trade[]>(`${BASE}/trades/refresh${params}`, { method: 'POST' });
}

// ── Notes ──

export async function getTradeNotes(tradeId: number): Promise<string> {
  const data = await fetchJSON<TradeNote>(`${BASE}/trades/${tradeId}/notes`);
  return data.notes;
}

export async function saveTradeNotes(tradeId: number, notes: string): Promise<void> {
  await fetchJSON(`${BASE}/trades/${tradeId}/notes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes }),
  });
}

// ── Tags ──

export async function getTradeTags(tradeId: number): Promise<string[]> {
  const data = await fetchJSON<TradeTag>(`${BASE}/trades/${tradeId}/tags`);
  return data.tags;
}

export async function addTradeTag(tradeId: number, tag: string): Promise<void> {
  await fetchJSON(`${BASE}/trades/${tradeId}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag }),
  });
}

export async function removeTradeTag(tradeId: number, tag: string): Promise<void> {
  await fetchJSON(`${BASE}/trades/${tradeId}/tags/${encodeURIComponent(tag)}`, {
    method: 'DELETE',
  });
}

export async function getAllTags(): Promise<string[]> {
  const data = await fetchJSON<{ tags: string[] }>(`${BASE}/tags`);
  return data.tags;
}

// ── Screenshots ──

export async function getTradeScreenshots(tradeId: number): Promise<Screenshot[]> {
  const data = await fetchJSON<{ screenshots: Screenshot[] }>(`${BASE}/trades/${tradeId}/screenshots`);
  return data.screenshots;
}

export async function uploadScreenshot(tradeId: number, file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const data = await fetchJSON<{ filename: string }>(`${BASE}/trades/${tradeId}/screenshots`, {
    method: 'POST',
    body: form,
  });
  return data.filename;
}

export async function deleteScreenshot(screenshotId: number): Promise<void> {
  await fetchJSON(`${BASE}/screenshots/${screenshotId}`, { method: 'DELETE' });
}

export function screenshotUrl(filename: string): string {
  return `${BASE}/screenshots/${filename}`;
}

// ── Calendar Notes ──

export async function getDayNote(dateKey: string): Promise<string> {
  const data = await fetchJSON<{ notes: string }>(`${BASE}/calendar/notes/${dateKey}`);
  return data.notes;
}

export async function saveDayNote(dateKey: string, notes: string): Promise<void> {
  await fetchJSON(`${BASE}/calendar/notes/${dateKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes }),
  });
}

export async function getAllDayNotes(): Promise<Record<string, string>> {
  return fetchJSON<Record<string, string>>(`${BASE}/calendar/notes`);
}

// ── Week Notes ──

export async function getWeekNote(weekKey: string): Promise<WeekNotes> {
  return fetchJSON<WeekNotes>(`${BASE}/calendar/week/${weekKey}`);
}

export async function saveWeekNote(weekKey: string, notes: WeekNotes): Promise<void> {
  await fetchJSON(`${BASE}/calendar/week/${weekKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(notes),
  });
}

// ── PnL Summary ──

export async function getPnlSummary(wallet?: string): Promise<PnlSummary> {
  const params = wallet ? `?wallet=${wallet}` : '';
  return fetchJSON<PnlSummary>(`${BASE}/pnl-summary${params}`);
}

// ── Candles ──

export async function getCandles(coin: string, interval: string, start: number, end: number): Promise<unknown[]> {
  return fetchJSON<unknown[]>(`${BASE}/candles?coin=${coin}&interval=${interval}&start=${start}&end=${end}`);
}
