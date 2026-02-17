export interface Trade {
  id: number;
  wallet: string;
  coin: string;
  side: 'B' | 'A';
  entry_px: number;
  exit_px: number | null;
  size: number;
  pnl: number;
  fees: number;
  open_time: number;
  close_time: number | null;
  hold_ms: number | null;
  mae: number | null;
  mfe: number | null;
  fill_ids: string;
}

export interface TradeNote {
  notes: string;
}

export interface TradeTag {
  tags: string[];
}

export interface Screenshot {
  id: number;
  filename: string;
  original_name: string;
  uploaded_at: number;
}

export interface CalendarDayData {
  trades: Trade[];
  pnl: number;
}

export interface WeekNotes {
  review: string;
  well: string;
  improve: string;
}

export interface PnlSummary {
  gross_pnl: number;
  total_fees: number;
  total_funding: number | null;
  net_pnl: number;
}

export interface DateRange {
  start: Date;
  end?: Date;
  mode: 'range' | 'before' | 'after';
  group: 'open' | 'close';
}

export interface TagFilter {
  tags: Set<string>;
  mode: 'include' | 'exclude';
  logic: 'any' | 'all';
}
