import { useState, useRef, useEffect } from 'react';

interface Props {
  allTags: string[];
  selectedTags: Set<string>;
  logic: 'any' | 'all';
  onTagsChange: (tags: Set<string>) => void;
  onLogicChange: (logic: 'any' | 'all') => void;
}

export default function TagFilter({ allTags, selectedTags, logic, onTagsChange, onLogicChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function toggle(tag: string) {
    const next = new Set(selectedTags);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    onTagsChange(next);
  }

  function clearAll() {
    onTagsChange(new Set());
  }

  if (allTags.length === 0) return null;

  const hasSelection = selectedTags.size > 0;

  return (
    <div className="tag-filter" ref={ref}>
      <button
        className={`filter-select tag-filter-btn ${hasSelection ? 'active' : ''}`}
        onClick={() => setOpen(!open)}
      >
        {hasSelection ? `Tags (${selectedTags.size})` : 'Tags'}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ marginLeft: 4, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <path d="M1 3.5L5 7.5L9 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>

      {open && (
        <div className="tag-filter-dropdown">
          {/* AND/OR toggle */}
          <div className="tag-filter-logic">
            <span className="secondary-text" style={{ fontSize: 10 }}>Match:</span>
            <button
              className={`tag-logic-btn ${logic === 'any' ? 'active' : ''}`}
              onClick={() => onLogicChange('any')}
            >
              Any (OR)
            </button>
            <button
              className={`tag-logic-btn ${logic === 'all' ? 'active' : ''}`}
              onClick={() => onLogicChange('all')}
            >
              All (AND)
            </button>
          </div>

          <div className="tag-filter-divider" />

          {/* Tag list */}
          <div className="tag-filter-list">
            {allTags.map(tag => (
              <label key={tag} className="tag-filter-item">
                <input
                  type="checkbox"
                  checked={selectedTags.has(tag)}
                  onChange={() => toggle(tag)}
                />
                <span className="tag-filter-label">{tag}</span>
              </label>
            ))}
          </div>

          {hasSelection && (
            <>
              <div className="tag-filter-divider" />
              <button className="tag-filter-clear" onClick={clearAll}>
                Clear all
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
