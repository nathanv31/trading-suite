import { useState, useEffect, useRef } from 'react';
import type { Screenshot } from '../../types';
import { getTradeScreenshots, uploadScreenshot, deleteScreenshot, screenshotUrl } from '../../api/client';

interface Props {
  tradeId: number;
  expanded: boolean;
}

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export default function ScreenshotGallery({ tradeId, expanded }: Props) {
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded) {
      setLoading(true);
      getTradeScreenshots(tradeId)
        .then(setScreenshots)
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [expanded, tradeId]);

  useEffect(() => {
    if (lightboxIdx === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightboxIdx(null);
      else if (e.key === 'ArrowRight')
        setLightboxIdx(i => (i !== null ? (i + 1) % screenshots.length : null));
      else if (e.key === 'ArrowLeft')
        setLightboxIdx(i => (i !== null ? (i - 1 + screenshots.length) % screenshots.length : null));
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [lightboxIdx, screenshots.length]);

  function showError(msg: string) {
    setError(msg);
    setTimeout(() => setError(''), 3000);
  }

  async function handleUpload(file: File) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      showError('Invalid file type');
      return;
    }
    if (file.size > MAX_SIZE) {
      showError('File too large (max 10MB)');
      return;
    }
    setUploading(true);
    try {
      await uploadScreenshot(tradeId, file);
      const updated = await getTradeScreenshots(tradeId);
      setScreenshots(updated);
    } catch {
      showError('Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = '';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  }

  async function handleDelete(id: number) {
    await deleteScreenshot(id).catch(() => {});
    setScreenshots(prev => {
      const next = prev.filter(s => s.id !== id);
      // adjust lightbox if open
      if (lightboxIdx !== null) {
        if (next.length === 0) setLightboxIdx(null);
        else if (lightboxIdx >= next.length) setLightboxIdx(next.length - 1);
      }
      return next;
    });
  }

  return (
    <div className="ss-section">
      <h4>Screenshots</h4>

      {error && (
        <div className="loss-text" style={{ fontSize: 11, marginBottom: 8 }}>{error}</div>
      )}

      <div className="ss-gallery">
        {screenshots.map((ss, idx) => (
          <div key={ss.id} className="ss-thumb" onClick={() => setLightboxIdx(idx)}>
            <img src={screenshotUrl(ss.filename)} alt={ss.original_name} loading="lazy" />
            <button
              className="ss-delete-btn"
              onClick={e => { e.stopPropagation(); handleDelete(ss.id); }}
              title="Delete screenshot"
            >
              &times;
            </button>
          </div>
        ))}

        <div
          className={`ss-upload-zone${dragOver ? ' drag-over' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
          onDrop={handleDrop}
        >
          {uploading ? (
            <div className="ss-upload-spinner" />
          ) : (
            <>
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
              </svg>
              <span>Drop or click</span>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.gif,.webp"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
        </div>
      </div>

      {loading && screenshots.length === 0 && (
        <div className="secondary-text" style={{ fontSize: 11, marginTop: 8 }}>Loading...</div>
      )}

      {lightboxIdx !== null && screenshots[lightboxIdx] && (
        <div className="ss-lightbox" onClick={() => setLightboxIdx(null)}>
          <div className="ss-lightbox-content" onClick={e => e.stopPropagation()}>
            <img src={screenshotUrl(screenshots[lightboxIdx].filename)} alt="" />
            <button className="ss-lightbox-close" onClick={() => setLightboxIdx(null)}>&times;</button>
            {screenshots.length > 1 && (
              <>
                <button
                  className="ss-lightbox-nav ss-lightbox-prev"
                  onClick={() => setLightboxIdx(i => i !== null ? (i - 1 + screenshots.length) % screenshots.length : null)}
                >
                  &#8249;
                </button>
                <button
                  className="ss-lightbox-nav ss-lightbox-next"
                  onClick={() => setLightboxIdx(i => i !== null ? (i + 1) % screenshots.length : null)}
                >
                  &#8250;
                </button>
              </>
            )}
            <div className="ss-lightbox-info">
              <span>{screenshots[lightboxIdx].original_name}</span>
              <span className="secondary-text">{lightboxIdx + 1} / {screenshots.length}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
