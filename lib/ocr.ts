import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Tesseract from 'tesseract.js';
import { dataRoot } from './runtime-paths';

/*
 * Optional OCR for scanned image documents (JPG/PNG).
 *
 * The engine runs entirely inside Node.js:
 *  - tesseract.js loads its WASM core from the local tesseract.js-core package
 *    (no CDN download), and
 *  - language data is taken from the installed @tesseract.js-data/<lang>
 *    packages, which are copied once into the writable runtime data root.
 *
 * OCR therefore keeps working on an office LAN with no internet access after
 * `npm install` has completed. Urdu (urd) and English (eng) are enabled by
 * default; additional languages can be enabled by installing the matching
 * @tesseract.js-data package and listing its code in DPO_OCR_LANGS.
 *
 * All failures degrade gracefully: an unreadable/scanned image never breaks an
 * upload. When OCR cannot run the document is marked text_indexed=false so the
 * Admin "rebuild index" job can retry it later.
 */

const MAX_OCR_CHARACTERS = 200_000;
const DEFAULT_LANGS = 'eng+urd';
const WORKER_START_TIMEOUT_MS = 60_000;
const RECOGNIZE_TIMEOUT_MS = 120_000;
const COOLDOWN_AFTER_FAILURE_MS = 5 * 60_000;
const MEMO_LIMIT = 100;
const DATA_PACKAGE_SCOPE = '@tesseract.js-data';

/**
 * Candidate project roots that can contain node_modules. import.meta.url /
 * __dirname cannot be used to anchor package lookups because Next.js
 * (Turbopack) rewrites them to virtual paths such as "[project]", so we
 * resolve from the npm-provided working directory instead.
 */
function candidateRoots(): string[] {
  const roots = new Set<string>();
  for (const value of [process.env.npm_config_local_prefix, process.env.INIT_CWD, process.cwd()]) {
    if (value) roots.add(path.resolve(value));
  }
  let dir = path.resolve(process.cwd());
  for (;;) {
    roots.add(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [...roots];
}

/** Absolute path of an installed @tesseract.js-data/<lang> data file, if present. */
async function installedDataGzPath(lang: string): Promise<string | null> {
  const fileName = `${lang}.traineddata.gz`;
  const relative = path.join('node_modules', DATA_PACKAGE_SCOPE, lang, '4.0.0_best_int', fileName);
  for (const root of candidateRoots()) {
    const candidate = path.join(root, relative);
    const found = await fs.access(candidate).then(() => true, () => false);
    if (found) return candidate;
  }
  return null;
}

export interface OcrAttempt {
  /** True when a real OCR run finished (its text may still be empty for a blank image). */
  attempted: boolean;
  text: string;
  /** Language codes the engine actually loaded. */
  langs: string[];
  /** Set when attempted=false explains why OCR did not run. */
  reason?: string;
}

function parseLanguages(): string[] {
  const raw = (process.env.DPO_OCR_LANGS || DEFAULT_LANGS).trim();
  return raw
    .split(/[+,;]/)
    .map((code) => code.trim().toLowerCase())
    .filter((code) => /^[a-z_]+$/.test(code))
    .slice(0, 6);
}

function ocrEnabled(): boolean {
  const raw = (process.env.DPO_OCR_ENABLED || '').trim().toLowerCase();
  if (!raw) return true; // enabled unless explicitly switched off
  return !['0', 'false', 'off', 'no'].includes(raw);
}

/** Runtime directory used to stage .traineddata.gz files for tesseract.js. */
function ocrDataDir(): string {
  return process.env.DPO_OCR_LANG_PATH?.trim() || path.join(dataRoot, 'ocr-data');
}

/** In-process memo so uploading the identical scan twice does not re-OCR it. */
const memoStore = new Map<string, OcrAttempt>();

let prepared: Promise<{ dir: string; cacheDir: string; langs: string[] } | null> | null = null;

/**
 * Prepares a single directory that contains `<lang>.traineddata.gz` for every
 * configured language. When DPO_OCR_LANG_PATH is set that directory is used
 * as-is (the operator supplies the files); otherwise the files are copied from
 * the installed @tesseract.js-data packages.
 */
function prepareLangDirectory(): Promise<{ dir: string; cacheDir: string; langs: string[] } | null> {
  if (!prepared) {
    prepared = (async () => {
      const dir = ocrDataDir();
      const cacheDir = path.join(dataRoot, 'ocr-cache');
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.mkdir(cacheDir, { recursive: true });
      } catch (error) {
        console.error('OCR_DATA_DIR_ERROR', dir, error);
        return null;
      }
      const langs = parseLanguages();
      const available: string[] = [];
      for (const lang of langs) {
        const fileName = `${lang}.traineddata.gz`;
        const target = path.join(dir, fileName);
        const targetExists = await fs.access(target).then(() => true, () => false);
        if (targetExists) {
          available.push(lang);
          continue;
        }
        const source = await installedDataGzPath(lang);
        if (!source) {
          console.warn(`OCR_LANGUAGE_UNAVAILABLE ${lang} — install @tesseract.js-data/${lang} or place ${fileName} in DPO_OCR_LANG_PATH`);
          continue;
        }
        try {
          await fs.copyFile(source, target);
          available.push(lang);
        } catch (error) {
          console.warn(`OCR_LANGUAGE_COPY_ERROR ${lang}`, error);
        }
      }
      if (available.length === 0) return null;
      return { dir, cacheDir, langs: available };
    })();
  }
  return prepared;
}

let activeWorker: Tesseract.Worker | null = null;
let workerStartPromise: Promise<Tesseract.Worker | null> | null = null;
let cooldownUntil = 0;
let jobChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = jobChain.then(task, task);
  jobChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Returns the shared worker, starting it once and reusing it for later images. */
function getWorker(): Promise<Tesseract.Worker | null> {
  if (activeWorker) return Promise.resolve(activeWorker);
  if (Date.now() < cooldownUntil) return Promise.resolve(null);
  if (!workerStartPromise) {
    workerStartPromise = (async () => {
      try {
        const preparedDir = await prepareLangDirectory();
        if (!preparedDir) return null;
        const worker = await withTimeout(
          Tesseract.createWorker(preparedDir.langs, Tesseract.OEM.LSTM_ONLY, {
            langPath: preparedDir.dir,
            gzip: true,
            cachePath: preparedDir.cacheDir,
            cacheMethod: 'write',
            logger: () => {},
          }),
          WORKER_START_TIMEOUT_MS,
          'OCR engine start timed out',
        );
        activeWorker = worker;
        return worker;
      } catch (error) {
        console.error('OCR_WORKER_START_ERROR', error);
        cooldownUntil = Date.now() + COOLDOWN_AFTER_FAILURE_MS;
        return null;
      } finally {
        workerStartPromise = null;
      }
    })();
  }
  return workerStartPromise;
}

async function discardWorker(worker: Tesseract.Worker) {
  if (activeWorker === worker) activeWorker = null;
  try { await worker.terminate(); } catch { /* best-effort */ }
}

/**
 * Recognizes text in a JPG/PNG buffer. Returns attempted=false when OCR is
 * disabled, no language data is available, or the engine failed — callers
 * should then leave the document flagged for a later retry.
 */
export function ocrImageText(bytes: Buffer): Promise<OcrAttempt> {
  return enqueue(async () => {
    const disabled = !ocrEnabled();
    if (disabled) return { attempted: false, text: '', langs: [], reason: 'OCR disabled by DPO_OCR_ENABLED' };

    const langs = parseLanguages();
    if (langs.length === 0) return { attempted: false, text: '', langs: [], reason: 'No OCR languages configured' };

    const preparedDir = await prepareLangDirectory();
    if (!preparedDir || preparedDir.langs.length === 0) {
      return { attempted: false, text: '', langs: [], reason: 'No OCR language data available (see DPO_OCR_LANG_PATH)' };
    }

    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    const memo = memoStore.get(sha);
    if (memo) return { ...memo };

    const worker = await getWorker();
    if (!worker) return { attempted: false, text: '', langs: [], reason: 'OCR engine unavailable' };

    try {
      const result = await withTimeout(
        worker.recognize(bytes, {}, { text: true }),
        RECOGNIZE_TIMEOUT_MS,
        'OCR recognition timed out',
      );
      const text = (result?.data?.text || '').replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_OCR_CHARACTERS);
      const attempt: OcrAttempt = { attempted: true, text, langs: preparedDir.langs };
      memoStore.set(sha, attempt);
      if (memoStore.size > MEMO_LIMIT) {
        const oldest = memoStore.keys().next().value;
        if (oldest !== undefined) memoStore.delete(oldest);
      }
      return attempt;
    } catch (error) {
      console.error('OCR_RECOGNIZE_ERROR', error);
      // The worker may be stuck after a timeout; recreate it on the next use.
      cooldownUntil = Date.now() + COOLDOWN_AFTER_FAILURE_MS;
      void discardWorker(worker);
      return { attempted: false, text: '', langs: [], reason: error instanceof Error ? error.message : 'OCR recognition failed' };
    }
  });
}
