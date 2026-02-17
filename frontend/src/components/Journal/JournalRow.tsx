import { useState, useEffect, useRef } from 'react';
import type { Trade } from '../../types';
import { formatHold, formatPrice, formatPnl, formatTime } from '../../utils/formatters';
import { getTradeNotes, saveTradeNotes, getTradeTags, addTradeTag, removeTradeTag } from '../../api/client';

interface Props {
  trade: Trade;
}

export default function JournalRow({ trade }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isWin = trade.pnl > 0;
  const openDt = new Date(trade.open_time);
  const closeDt = trade.close_time ? new Date(trade.close_time) : null;
  const holdStr = formatHold(trade.hold_ms);
  const sideStr = trade.side === 'B' ? '\u2197 Long' : '\u2198 Short';
  const sideCol = trade.side === 'B' ? 'profit-text' : 'loss-text';
  const notional = (trade.entry_px * trade.size).toFixed(0);
  const entryStr = formatPrice(trade.entry_px);
  const exitStr = trade.exit_px ? formatPrice(trade.exit_px) : '\u2014';
  const pctChg = trade.exit_px
    ? (((trade.exit_px - trade.entry_px) / trade.entry_px) * 100 * (trade.side === 'A' ? -1 : 1)).toFixed(2)
    : null;
  const maePct = trade.mae ? (trade.mae * 100).toFixed(2) : '\u2014';
  const mfePct = trade.mfe ? (trade.mfe * 100).toFixed(2) : '\u2014';
  const fees = trade.fees ? `-$${trade.fees.toFixed(2)}` : '$0.00';
  const actualRR = trade.mae && trade.mfe ? (trade.mfe / trade.mae).toFixed(2) : '\u2014';

  useEffect(() => {
    if (expanded) {
      getTradeNotes(trade.id).then(setNotes).catch(() => {});
      getTradeTags(trade.id).then(setTags).catch(() => {});
    }
  }, [expanded, trade.id]);

  function handleNotesChange(value: string) {
    setNotes(value);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTradeNotes(trade.id, value).catch(() => {});
    }, 500);
  }

  async function handleAddTag() {
    const val = tagInput.trim();
    if (!val) return;
    await addTradeTag(trade.id, val).catch(() => {});
    setTags(prev => prev.includes(val) ? prev : [...prev, val]);
    setTagInput('');
  }

  async function handleRemoveTag(tag: string) {
    await removeTradeTag(trade.id, tag).catch(() => {});
    setTags(prev => prev.filter(t => t !== tag));
  }

  return (
    <div className="j-row">
      <div className="j-row-main" onClick={() => setExpanded(!expanded)}>
        <div className={isWin ? 'j-win-bar' : 'j-loss-bar'} />
        <div className="coin-badge">{trade.coin.charAt(0)}</div>
        <div className="jcol-symbol">
          <div className="font-bold text-sm">{trade.coin}</div>
          <div className="secondary-text" style={{ fontSize: 10 }}>{openDt.toLocaleDateString()}</div>
        </div>
        <div className="jcol-side">
          <div className={`text-xs ${sideCol} font-semibold`}>{sideStr}</div>
          <div className="secondary-text" style={{ fontSize: 11 }}>${notional}</div>
        </div>
        <div className="jcol-times secondary-text" style={{ fontSize: 11 }}>
          <div>{formatTime(trade.open_time)}</div>
          <div>{closeDt ? formatTime(trade.close_time!) : '\u2014'}</div>
        </div>
        <div className="jcol-hold">
          <span className="hold-badge">{holdStr}</span>
        </div>
        <div className="jcol-entry" style={{ fontSize: 11 }}>
          <div>{entryStr} <span className="secondary-text">\u2192</span> {exitStr}</div>
          {pctChg !== null && (
            <div className={parseFloat(pctChg) >= 0 ? 'profit-text' : 'loss-text'} style={{ fontSize: 10 }}>
              {pctChg}%
            </div>
          )}
        </div>
        <div className="jcol-mae secondary-text" style={{ fontSize: 11 }}>{maePct}%</div>
        <div className="jcol-mfe secondary-text" style={{ fontSize: 11 }}>{mfePct}%</div>
        <div className="jcol-fees secondary-text" style={{ fontSize: 11 }}>{fees}</div>
        <div className="jcol-pnl">
          <span className={`pnl-badge ${isWin ? 'win' : 'loss'}`}>
            {formatPnl(trade.pnl)}
          </span>
        </div>
        <button className={`expand-btn ${expanded ? 'open' : ''}`} onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {expanded && (
        <div className="j-detail">
          <div className="detail-grid">
            {/* Stats */}
            <div className="detail-card">
              <h4>Trade Stats</h4>
              {[
                ['Entry Price', entryStr],
                ['Exit Price', exitStr],
                ['Size', `${trade.size.toFixed(4)} ${trade.coin}`],
                ['Notional', `$${notional}`],
                ['Hold Time', holdStr],
                ['MAE', <span className="loss-text">{maePct}%</span>],
                ['MFE', <span className="profit-text">{mfePct}%</span>],
                ['Actual R:R', <span className={parseFloat(String(actualRR)) >= 1 ? 'profit-text' : 'loss-text'}>{actualRR}</span>],
                ['Fees', <span className="loss-text">{fees}</span>],
                ['Net PnL', <span className={`${isWin ? 'profit-text' : 'loss-text'} font-bold`}>{formatPnl(trade.pnl)}</span>],
              ].map(([label, value], i) => (
                <div key={i} className="stat-row">
                  <span className="stat-label">{label}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>

            {/* Notes + Tags */}
            <div className="detail-card">
              <h4>Notes</h4>
              <textarea
                className="note-area"
                placeholder="Add your trade notes here — setup, reasoning, emotions, mistakes..."
                value={notes}
                onChange={e => handleNotesChange(e.target.value)}
              />
              <h4 style={{ marginTop: 14 }}>Tags</h4>
              <div className="flex flex-wrap gap-2 mb-3">
                {tags.length === 0 ? (
                  <span className="secondary-text" style={{ fontSize: 11 }}>No tags yet</span>
                ) : (
                  tags.map(tag => (
                    <span key={tag} className="tag-chip">
                      {tag}
                      <span className="del" onClick={() => handleRemoveTag(tag)}>&times;</span>
                    </span>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="tag-input"
                  placeholder="+ Add tag"
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                />
                <button onClick={handleAddTag} className="page-btn" style={{ padding: '4px 10px' }}>Add</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
