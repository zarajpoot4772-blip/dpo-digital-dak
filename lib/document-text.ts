import fs from 'node:fs/promises';
import path from 'node:path';
import PDFParser from 'pdf2json';
import mammoth from 'mammoth';
import { storagePath } from './runtime-paths';

const MAX_INDEXED_CHARACTERS = 200_000;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
let ocrWorkerPromise: Promise<any> | undefined;

function cleanText(value: string) {
  return value.replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_INDEXED_CHARACTERS);
}

async function extractImageText(bytes: Buffer) {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('eng+urd', 1, { langPath: path.join(process.cwd(), 'assets', 'tessdata'), gzip: true });
    })();
  }
  const worker = await ocrWorkerPromise;
  const result = await worker.recognize(bytes);
  return cleanText(result?.data?.text || '');
}

async function extractPdfText(bytes: Buffer) {
  return new Promise<string>((resolve, reject) => {
    const parser: any = new (PDFParser as any)();
    parser.on('pdfParser_dataError', (event: any) => reject(event?.parserError || new Error('PDF text extraction failed')));
    parser.on('pdfParser_dataReady', (pdf: any) => {
      const parts: string[] = [];
      for (const page of pdf?.Pages || []) {
        for (const text of page?.Texts || []) {
          for (const run of text?.R || []) {
            if (run?.T) parts.push(String(run.T));
          }
        }
      }
      resolve(cleanText(parts.join(' ')));
    });
    try { parser.parseBuffer(bytes); } catch (error) { reject(error); }
  });
}

export async function extractDocumentText(bytes: Buffer, mime: string, options: { strictOcr?: boolean; enableOcr?: boolean } = {}) {
  if (mime === DOCX_MIME) {
    const extracted = await mammoth.extractRawText({ buffer: bytes });
    return cleanText(extracted.value || '');
  }
  if (mime === 'application/pdf') return extractPdfText(bytes);
  if (mime === 'image/png' || mime === 'image/jpeg') {
    if (!options.enableOcr) return '';
    try { return await extractImageText(bytes); }
    catch (error) {
      ocrWorkerPromise = undefined;
      console.error('IMAGE_OCR_ERROR', error);
      if (options.strictOcr) throw error;
    }
  }
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
      const text = await extractDocumentText(bytes, document.file_type, { strictOcr: force, enableOcr: force });
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
