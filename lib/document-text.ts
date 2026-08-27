import fs from 'node:fs/promises';
import mammoth from 'mammoth';
import { storagePath } from './runtime-paths';

const MAX_INDEXED_CHARACTERS = 200_000;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function cleanText(value: string) {
  return value.replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_INDEXED_CHARACTERS);
}

async function extractPdfText(bytes: Buffer) {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // PDF.js disables real workers in Node. Register its worker handler in the
  // same process so text extraction works in Next's bundled server runtime.
  if (!(globalThis as any).pdfjsWorker) {
    (globalThis as any).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  }
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true, useWorkerFetch: false, isEvalSupported: false });
  const pdf = await loading.promise;
  try {
    const parts: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages && parts.join(' ').length < MAX_INDEXED_CHARACTERS; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      parts.push(content.items.map((item: any) => String(item.str || '')).join(' '));
    }
    return cleanText(parts.join(' '));
  } finally {
    await pdf.destroy().catch(() => undefined);
  }
}

export async function extractDocumentText(bytes: Buffer, mime: string) {
  if (mime === DOCX_MIME) {
    const extracted = await mammoth.extractRawText({ buffer: bytes });
    return cleanText(extracted.value || '');
  }
  if (mime === 'application/pdf') return extractPdfText(bytes);
  // Image-only files need a native OCR engine/model. Keep the upload usable
  // and leave the index empty instead of inventing text.
  return '';
}

export async function indexExistingDocumentText(db: any, force = false) {
  const pending = await db.query(
    `SELECT id,version_type,stored_filename,file_type FROM documents
     WHERE ${force ? 'true' : '(text_indexed=false OR text_indexed IS NULL)'} ORDER BY id LIMIT 500`
  );
  let indexed = 0;
  let failed = 0;
  for (const document of pending.rows) {
    try {
      const bytes = await fs.readFile(storagePath(document.version_type, document.stored_filename));
      const text = await extractDocumentText(bytes, document.file_type);
      await db.query('UPDATE documents SET search_text=$1,text_indexed=true WHERE id=$2', [text || '', document.id]);
      indexed += 1;
    } catch (error) {
      failed += 1;
      console.error('DOCUMENT_TEXT_INDEX_ERROR', document.id, error);
      await db.query('UPDATE documents SET search_text=$1,text_indexed=false WHERE id=$2', ['', document.id]);
    }
  }
  return { indexed, failed, total: pending.rows.length };
}
