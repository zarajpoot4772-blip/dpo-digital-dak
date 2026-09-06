'use client';

/**
 * Client-side Word layout -> PDF converter used only by the approval dialog.
 *
 * Hostinger (and other Linux web hosts) do not have LibreOffice/MS Word, so the
 * server-side converted PDF is a plain-text fallback that loses Word tables,
 * columns and exact Urdu layout. To make the approval preview match what the
 * DPO sees in the Document Review Portal (the browser-rendered Word layout) and
 * to make the signed copy use that same layout, we render the original DOCX in
 * the browser with docx-preview, rasterize every page and build a real PDF with
 * pdf-lib. The server then stamps that PDF with the selected signature/stamp.
 */

export interface BuiltDocxPdf {
  bytes: Uint8Array;
  pageCount: number;
  url: string;
}

export async function buildDocxPdf(
  src: string,
  onProgress?: (done: number, total: number) => void
): Promise<BuiltDocxPdf> {
  const response = await fetch(src, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Word document could not be loaded (${response.status})`);
  const blob = await response.blob();

  const [{ renderAsync }, { PDFDocument }, { default: html2canvas }] = await Promise.all([
    import('docx-preview'),
    import('pdf-lib'),
    import('html2canvas')
  ]);

  // Fixed-width off-screen host keeps docx-preview pagination and layout
  // identical to the read-mode preview (which also renders at ~794 px).
  // Off-screen host keeps the real Word layout (natural A4 width) for the
  // raster capture. overflow must stay visible: html2canvas applies ancestor
  // clip paths, so a truncated host would clip every captured page.
  const holder = document.createElement('div');
  holder.className = 'docx-capture-holder';
  holder.style.cssText =
    'position:fixed;left:-10000px;top:0;width:800px;background:#fff;z-index:-1;pointer-events:none;';
  document.body.appendChild(holder);

  try {
    await renderAsync(blob, holder, undefined, {
      className: 'dpo-docx-page',
      experimental: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: true
    });
    await document.fonts.ready;

    const sections = Array.from(holder.querySelectorAll<HTMLElement>('section.dpo-docx-page'));
    if (!sections.length) throw new Error('Word document has no renderable pages');

    const pdf = await PDFDocument.create();
    for (let index = 0; index < sections.length; index++) {
      onProgress?.(index, sections.length);
      const section = sections[index];
      const rect = section.getBoundingClientRect();
      if (!rect.width || !rect.height) throw new Error(`Word page ${index + 1} has no measurable size`);
      // 96 CSS px = 72 pt
      const widthPt = rect.width * 0.75;
      const heightPt = rect.height * 0.75;
      const canvas = await html2canvas(section, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
        width: rect.width,
        height: rect.height
      });
      const jpeg = canvas.toDataURL('image/jpeg', 0.92);
      const image = await pdf.embedJpg(jpeg);
      const page = pdf.addPage([widthPt, heightPt]);
      page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt });
    }
    onProgress?.(sections.length, sections.length);

    const bytes = new Uint8Array(await pdf.save());
    // Keep the base64 approval request comfortably below proxy body-size
    // limits (nginx client_max_body_size 25m): 14 MB of PDF becomes ~19 MB of
    // base64. The dialog falls back to the server PDF preview when larger.
    if (bytes.length > 14 * 1024 * 1024) throw new Error('Rendered Word layout is too large for controlled approval');
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    return { bytes, pageCount: pdf.getPageCount(), url };
  } finally {
    holder.remove();
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
