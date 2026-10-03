import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Worker } from "tesseract.js";

/*
 * Local OCR engine.
 *
 * tesseract.js will happily download its language models from a CDN, which is
 * both slow and a privacy problem for uploaded documents. Instead the
 * `.traineddata.gz` files shipped by the installed @tesseract.js-data packages
 * are staged into a temp directory and handed to the worker via `langPath`, so
 * recognition runs completely offline.
 */

const DATA_SCOPE = "@tesseract.js-data";
const DATA_SUBDIR = "4.0.0_best_int";
const START_TIMEOUT_MS = 120_000;
const RECOGNIZE_TIMEOUT_MS = 180_000;

function candidateRoots(): string[] {
  const roots = new Set<string>();
  for (const value of [
    process.env.npm_config_local_prefix,
    process.env.INIT_CWD,
    process.cwd(),
  ]) {
    if (value) roots.add(path.resolve(/* turbopackIgnore: true */ value));
  }
  let dir = path.resolve(/* turbopackIgnore: true */ process.cwd());
  for (;;) {
    roots.add(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return [...roots];
}

async function installedDataFile(lang: string): Promise<string | null> {
  const relative = path.join(
    "node_modules",
    DATA_SCOPE,
    lang,
    DATA_SUBDIR,
    `${lang}.traineddata.gz`,
  );
  for (const root of candidateRoots()) {
    const candidate = path.join(/* turbopackIgnore: true */ root, relative);
    if (await fs.access(candidate).then(() => true, () => false)) return candidate;
  }
  return null;
}

let langDirPromise: Promise<{ dir: string; cacheDir: string }> | null = null;

function stagingDirs(): Promise<{ dir: string; cacheDir: string }> {
  langDirPromise ??= (async () => {
    const base = path.join(os.tmpdir(), "file-converter-ocr");
    const dir = path.join(base, "lang");
    const cacheDir = path.join(base, "cache");
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(cacheDir, { recursive: true });
    return { dir, cacheDir };
  })();
  return langDirPromise;
}

async function stageLanguages(langs: string[]): Promise<{
  dir: string;
  cacheDir: string;
  available: string[];
}> {
  const { dir, cacheDir } = await stagingDirs();
  const available: string[] = [];

  for (const lang of langs) {
    const target = path.join(dir, `${lang}.traineddata.gz`);
    if (await fs.access(target).then(() => true, () => false)) {
      available.push(lang);
      continue;
    }
    const source = await installedDataFile(lang);
    if (!source) continue;
    await fs.copyFile(source, target).then(
      () => available.push(lang),
      () => undefined,
    );
  }

  return { dir, cacheDir, available };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const workers = new Map<string, Promise<Worker>>();
// OCR is CPU bound; serialise jobs so concurrent uploads cannot exhaust memory.
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function getWorker(langs: string[]): Promise<Worker> {
  const key = langs.join("+");
  let existing = workers.get(key);
  if (existing) return existing;

  const created = (async () => {
    const { dir, cacheDir, available } = await stageLanguages(langs);
    if (available.length === 0) {
      throw new Error(
        `OCR language data for "${langs.join("+")}" is not installed on this server.`,
      );
    }
    const Tesseract = await import("tesseract.js");
    return withTimeout(
      Tesseract.createWorker(available, Tesseract.OEM.LSTM_ONLY, {
        langPath: dir,
        gzip: true,
        cachePath: cacheDir,
        cacheMethod: "write",
        logger: () => {},
        errorHandler: () => {},
      }),
      START_TIMEOUT_MS,
      "The OCR engine took too long to start.",
    );
  })();

  workers.set(key, created);
  created.catch(() => workers.delete(key));
  return created;
}

export async function recognise(images: Buffer[], langSpec: string): Promise<string[]> {
  const langs = langSpec
    .split(/[+,]/)
    .map((l) => l.trim().toLowerCase())
    .filter((l) => /^[a-z_]+$/.test(l))
    .slice(0, 4);

  return enqueue(async () => {
    const worker = await getWorker(langs.length ? langs : ["eng"]);
    const out: string[] = [];
    for (const image of images) {
      const { data } = await withTimeout(
        worker.recognize(image),
        RECOGNIZE_TIMEOUT_MS,
        "OCR timed out on this page — try fewer pages or a smaller scan.",
      );
      out.push((data.text ?? "").trim());
    }
    return out;
  });
}
