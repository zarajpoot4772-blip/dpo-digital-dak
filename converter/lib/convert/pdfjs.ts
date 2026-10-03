import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Locate an installed package directory without handing the bundler a literal
 * `require.resolve("pkg/file")` — Turbopack rewrites those into virtual
 * "[project]/…" paths that Node cannot import at runtime.
 */
function packageDir(name: string): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth++) {
    const candidate = path.join(/* turbopackIgnore: true */ dir, "node_modules", name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const req = createRequire(
    pathToFileURL(path.join(process.cwd(), "package.json")).href,
  );
  const specifier = [name, "package.json"].join("/");
  return path.dirname(req.resolve(specifier));
}

let pdfjsDir: string | null = null;
function pdfjsPath(...parts: string[]): string {
  pdfjsDir ??= packageDir("pdfjs-dist");
  return path.join(/* turbopackIgnore: true */ pdfjsDir, ...parts);
}

let pdfjsPromise: Promise<any> | null = null;

export async function loadPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
      // Node has no browser Worker, so pdf.js falls back to importing the
      // worker module directly. Give it a real file:// URL.
      lib.GlobalWorkerOptions.workerSrc = pathToFileURL(
        pdfjsPath("legacy", "build", "pdf.worker.mjs"),
      ).href;
      return lib;
    })();
  }
  return pdfjsPromise;
}

export async function openPdf(bytes: Uint8Array): Promise<any> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    // pdf.js transfers (and detaches) the buffer, so hand it a private copy.
    data: new Uint8Array(bytes),
    standardFontDataUrl: pdfjsPath("standard_fonts") + path.sep,
    cMapUrl: pdfjsPath("cmaps") + path.sep,
    cMapPacked: true,
    wasmUrl: pdfjsPath("wasm") + path.sep,
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });
  return task.promise;
}

export type TextItem = {
  str: string;
  x: number;
  /** y measured from the top of the page */
  y: number;
  width: number;
  height: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  space: boolean;
};

export type TextLine = {
  y: number;
  x: number;
  items: TextItem[];
  /** Full line text, columns separated by a tab character. */
  text: string;
  /** Line split into columns using the horizontal gaps found in the PDF. */
  cells: string[];
  fontSize: number;
  bold: boolean;
};

export type PdfPageText = {
  pageNumber: number;
  width: number;
  height: number;
  lines: TextLine[];
};

function fontFlags(name: string): { bold: boolean; italic: boolean } {
  return {
    bold: /bold|black|heavy|semibold|[-,_]bd\b/i.test(name),
    italic: /italic|oblique|[-,_]it\b/i.test(name),
  };
}

/** Pull positioned text out of every page of a PDF. */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfPageText[]> {
  const doc = await openPdf(bytes);
  const pages: PdfPageText[] = [];

  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });

      // Resolving the operator list populates commonObjs so we can read the
      // real embedded font names (needed for bold / italic detection).
      await page.getOperatorList().catch(() => undefined);

      const content = await page.getTextContent({
        includeMarkedContent: false,
        disableNormalization: false,
      });

      const styles: Record<string, any> = content.styles ?? {};
      const fontCache = new Map<string, { bold: boolean; italic: boolean }>();

      const resolveFont = (fontName: string) => {
        if (fontCache.has(fontName)) return fontCache.get(fontName)!;
        let name = "";
        try {
          const obj = page.commonObjs.get(fontName);
          name = String(obj?.name ?? "");
        } catch {
          name = "";
        }
        if (!name) name = String(styles[fontName]?.fontFamily ?? fontName ?? "");
        const flags = fontFlags(name);
        fontCache.set(fontName, flags);
        return flags;
      };

      const items: TextItem[] = [];
      for (const raw of content.items as any[]) {
        if (typeof raw.str !== "string" || raw.str.length === 0) continue;
        const tr = raw.transform as number[];
        const fontSize = Math.hypot(tr[2], tr[3]) || Math.abs(tr[3]) || 10;
        const flags = resolveFont(String(raw.fontName ?? ""));
        items.push({
          str: raw.str,
          x: tr[4],
          y: viewport.height - tr[5],
          width: raw.width ?? 0,
          height: raw.height || fontSize,
          fontSize,
          bold: flags.bold,
          italic: flags.italic,
          space: raw.str.trim().length === 0,
        });
      }

      pages.push({
        pageNumber: n,
        width: viewport.width,
        height: viewport.height,
        lines: groupIntoLines(items),
      });
      page.cleanup();
    }
  } finally {
    await doc.destroy().catch(() => {});
  }

  return pages;
}

const COLUMN_SEPARATOR = "\t";

/** Cluster positioned glyph runs into visual lines, top-to-bottom. */
export function groupIntoLines(items: TextItem[]): TextLine[] {
  const real = items.filter((i) => i.str.length > 0);
  if (real.length === 0) return [];

  const sorted = [...real].sort((a, b) => a.y - b.y || a.x - b.x);
  const buckets: TextItem[][] = [];
  let current: TextItem[] = [sorted[0]];
  let anchor = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i];
    const tolerance = Math.max(2.5, Math.min(it.fontSize || 10, 28) * 0.5);
    if (Math.abs(it.y - anchor) <= tolerance) {
      current.push(it);
      anchor = (anchor * (current.length - 1) + it.y) / current.length;
    } else {
      buckets.push(current);
      current = [it];
      anchor = it.y;
    }
  }
  buckets.push(current);

  const lines: TextLine[] = [];

  for (const bucket of buckets) {
    const line = bucket.sort((a, b) => a.x - b.x);
    const visible = line.filter((i) => !i.space);
    if (visible.length === 0) continue;

    let text = "";
    let prevEnd: number | null = null;
    let prevFont = visible[0].fontSize;

    for (const it of line) {
      const gap = prevEnd === null ? 0 : it.x - prevEnd;
      const unit = Math.max(1.5, (it.fontSize || prevFont || 10) * 0.25);

      if (it.space) {
        // pdf.js emits synthetic whitespace runs whose width equals the gap.
        if (it.width > unit * 6) text += COLUMN_SEPARATOR;
        else if (text && !text.endsWith(" ") && !text.endsWith(COLUMN_SEPARATOR)) text += " ";
        prevEnd = it.x + it.width;
        continue;
      }

      if (prevEnd !== null && !text.endsWith(COLUMN_SEPARATOR)) {
        if (gap > unit * 6) text += COLUMN_SEPARATOR;
        else if (gap > unit && !text.endsWith(" ") && !/^\s/.test(it.str)) text += " ";
      }
      text += it.str;
      prevEnd = it.x + it.width;
      prevFont = it.fontSize;
    }

    const trimmed = text.replace(/[ \t]+$/g, "").replace(/^[ \t]+/g, "");
    if (!trimmed) continue;

    lines.push({
      y: Math.min(...visible.map((i) => i.y)),
      x: visible[0].x,
      items: visible,
      text: trimmed.split(COLUMN_SEPARATOR).join(" ").replace(/\s{2,}/g, " ").trim(),
      cells: trimmed.split(COLUMN_SEPARATOR).map((c) => c.trim()),
      fontSize: Math.max(...visible.map((i) => i.fontSize)),
      bold: visible.every((i) => i.bold),
    });
  }

  return lines;
}

/** Render one PDF page to a PNG buffer using a native canvas. */
export async function renderPdfPage(
  doc: any,
  pageNumber: number,
  dpi: number,
): Promise<{ png: Buffer; width: number; height: number }> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const page = await doc.getPage(pageNumber);
  const scale = Math.max(0.2, Math.min(dpi, 600) / 72);
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
    intent: "print",
  }).promise;

  page.cleanup();
  return { png: canvas.toBuffer("image/png"), width, height };
}
