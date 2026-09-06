import fs from 'node:fs/promises';
import PDFParser from 'pdf2json';
import mammoth from 'mammoth';
import { ocrImageText } from './ocr';
import { storagePath } from './runtime-paths';

const MAX_INDEXED_CHARACTERS = 200_000;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface ExtractedText {
  text: string;
  /**
   * True when the best available extractor ran to completion.
   * For image documents this stays false when OCR is disabled, its language
   * data is missing, or the engine failed, so the Admin rebuild-index job can
   * retry the file later.
   */
  completed: boolean;
}

function cleanText(value: string) {
  return value.replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_INDEXED_CHARACTERS);
}

async function extractPdfText(bytes: Buffer): Promise<string> {
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

export async function extractDocumentText(bytes: Buffer, mime: string): Promise<ExtractedText> {
  if (mime === DOCX_MIME) {
    const extracted = await mammoth.extractRawText({ buffer: bytes });
    return { text: cleanText(extracted.value || ''), completed: true };
  }
  if (mime === 'application/pdf') {
    return { text: await extractPdfText(bytes), completed: true };
  }
  // JPG/PNG uploads go through the local OCR engine (English + Urdu by
  // default). OCR is optional: a scan that cannot be read never blocks the
  // upload and the file simply keeps its metadata-only search entry.
  if (mime === 'image/jpeg' || mime === 'image/png') {
    const attempt = await ocrImageText(bytes);
    return { text: attempt.text, completed: attempt.attempted };
  }
  return { text: '', completed: true };
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
      const extracted = await extractDocumentText(bytes, document.file_type);
      await db.query('UPDATE documents SET search_text=$1,text_indexed=$2 WHERE id=$3', [extracted.text || '', extracted.completed, document.id]);
      if (extracted.completed) indexed += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      console.error('DOCUMENT_TEXT_INDEX_ERROR', document.id, error);
      await db.query('UPDATE documents SET search_text=$1,text_indexed=false WHERE id=$2', ['', document.id]);
    }
  }
  return { indexed, failed, total: pending.rows.length };
}
