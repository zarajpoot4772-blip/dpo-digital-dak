'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Renders the ORIGINAL Word (.docx) file in the browser with the real Word
 * layout (tables, columns, Urdu/RTL text) using docx-preview.
 *
 * This is used by the Document Review Portal so the DPO sees the same layout
 * that the approval copy will contain, even on hosts (like Hostinger) that do
 * not have LibreOffice/Word installed.
 */
export default function WordDocPreview({ src, onError }: { src: string; onError?: () => void }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'rendering' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [pages, setPages] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setStatus('loading');
      setError('');
      setPages(0);
      try {
        const response = await fetch(src, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Word document could not be loaded (${response.status})`);
        const blob = await response.blob();
        const { renderAsync } = await import('docx-preview');
        const root = mountRef.current;
        if (!root || cancelled) return;
        root.innerHTML = '';
        setStatus('rendering');
        await renderAsync(blob, root, undefined, {
          className: 'dpo-docx-page',
          experimental: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: true
        });
        if (cancelled) return;
        setPages(root.querySelectorAll('section.dpo-docx-page').length);
        setStatus('ready');
      } catch (loadError: any) {
        if (!cancelled) {
          setStatus('error');
          setError(loadError?.message || 'Word document could not be rendered');
          onError?.();
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <div className="word-doc-preview">
      <div className="document-reader-toolbar">
        <span>
          {pages > 0 ? (
            <>
              <b>{pages}</b> page{pages === 1 ? '' : 's'} · scroll down to read
            </>
          ) : status === 'loading' ? (
            'Loading protected Word document…'
          ) : (
            'Word layout preview'
          )}
        </span>
        {status === 'rendering' && <small>Rendering Word layout…</small>}
      </div>
      {status === 'error' && (
        <div className="document-render-status">
          <b>Preview unavailable</b>
          <small>{error}</small>
        </div>
      )}
      <div className="word-doc-pages" ref={mountRef} />
    </div>
  );
}
