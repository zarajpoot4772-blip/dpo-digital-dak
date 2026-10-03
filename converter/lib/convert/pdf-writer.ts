import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Anchor to a real on-disk file: Turbopack virtualises `import.meta.url`.
const req = createRequire(pathToFileURL(path.join(process.cwd(), "package.json")).href);
const reshaper = req("arabic-persian-reshaper") as {
  ArabicShaper: { convertArabic: (value: string) => string };
};
const bidiModule = req("bidi-js") as any;
const bidi = (typeof bidiModule === "function" ? bidiModule : bidiModule.default)();

export const RTL_RE = /[\u0590-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;

/** pdf-lib draws glyphs in visual order: shape then bidi-reorder manually. */
export function shapeRtl(value: string): string {
  if (!RTL_RE.test(value)) return value;
  const shaped = reshaper.ArabicShaper.convertArabic(value);
  const levels = bidi.getEmbeddingLevels(shaped, "rtl");
  const chars = shaped.split("");
  for (const [start, end] of bidi.getReorderSegments(shaped, levels)) {
    for (let l = start, r = end; l < r; l++, r--) {
      const tmp = chars[l];
      chars[l] = chars[r];
      chars[r] = tmp;
    }
  }
  for (const [index, ch] of bidi.getMirroredCharactersMap(shaped, levels)) {
    chars[index] = ch;
  }
  return chars.join("");
}

export const PAGE_SIZES: Record<string, [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
  Legal: [612, 1008],
};

export type Span = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  size?: number;
  color?: [number, number, number];
};

type FontSet = {
  latin: PDFFont;
  latinBold: PDFFont;
  latinItalic: PDFFont;
  latinBoldItalic: PDFFont;
  arabic: PDFFont;
};

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

async function readFontFile(name: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(FONT_DIR, name));
  } catch {
    return null;
  }
}

/**
 * Minimal flowing-text PDF writer used by every "* to PDF" converter.
 * Handles word wrap, pagination, bold/italic runs, tables and Urdu/Arabic.
 */
export class PdfWriter {
  readonly doc: PDFDocument;
  private fonts!: FontSet;
  private page!: PDFPage;
  private y = 0;

  readonly width: number;
  readonly height: number;
  readonly margin: number;

  private constructor(doc: PDFDocument, size: [number, number], margin: number) {
    this.doc = doc;
    this.width = size[0];
    this.height = size[1];
    this.margin = margin;
  }

  static async create(options?: {
    pageSize?: string;
    landscape?: boolean;
    margin?: number;
    /** Embed the Naskh face — required for Urdu/Arabic/Persian content. */
    rtl?: boolean;
  }): Promise<PdfWriter> {
    const base = PAGE_SIZES[options?.pageSize ?? "A4"] ?? PAGE_SIZES.A4;
    const size: [number, number] = options?.landscape
      ? [base[1], base[0]]
      : [base[0], base[1]];

    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const writer = new PdfWriter(doc, size, options?.margin ?? 52);

    const dejavu = await readFontFile("DejaVuSans.ttf");
    const unicode = dejavu
      ? await doc.embedFont(dejavu, { subset: true })
      : await doc.embedFont(StandardFonts.Helvetica);

    let arabic = unicode;
    if (options?.rtl) {
      const naskh = await readFontFile("NotoNaskhArabic.ttf");
      // NOTE: subsetting drops the Arabic presentation-form glyphs produced by
      // the shaper, so the Naskh face has to be embedded in full.
      if (naskh) arabic = await doc.embedFont(naskh, { subset: false });
    }

    writer.fonts = {
      latin: unicode,
      latinBold: await doc.embedFont(StandardFonts.HelveticaBold),
      latinItalic: await doc.embedFont(StandardFonts.HelveticaOblique),
      latinBoldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
      arabic,
    };

    writer.newPage();
    return writer;
  }

  get contentWidth(): number {
    return this.width - this.margin * 2;
  }

  get cursorY(): number {
    return this.y;
  }

  newPage(): void {
    this.page = this.doc.addPage([this.width, this.height]);
    this.y = this.height - this.margin;
  }

  ensure(space: number): void {
    if (this.y - space < this.margin) this.newPage();
  }

  moveDown(amount: number): void {
    this.y -= amount;
    if (this.y < this.margin) this.newPage();
  }

  /**
   * pdf-lib's standard fonts only encode WinAnsi. Anything outside it has to
   * use the embedded Unicode face, which has no separate bold/italic file, so
   * bold is faked with a second offset draw.
   */
  private isWinAnsi(text: string): boolean {
    return /^[\x20-\x7e\xa0-\xff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]*$/.test(
      text,
    );
  }

  fontFor(text: string, bold = false, italic = false): { font: PDFFont; fake: boolean } {
    if (RTL_RE.test(text)) return { font: this.fonts.arabic, fake: bold };
    if (this.isWinAnsi(text)) {
      if (bold && italic) return { font: this.fonts.latinBoldItalic, fake: false };
      if (bold) return { font: this.fonts.latinBold, fake: false };
      if (italic) return { font: this.fonts.latinItalic, fake: false };
      return { font: this.fonts.latin, fake: false };
    }
    return { font: this.fonts.latin, fake: bold };
  }

  widthOf(text: string, size: number, bold = false, italic = false): number {
    const { font } = this.fontFor(text, bold, italic);
    try {
      return font.widthOfTextAtSize(text, size);
    } catch {
      return text.length * size * 0.5;
    }
  }

  private sanitise(text: string): string {
    // Strip control characters pdf-lib cannot encode.
    return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  }

  drawRaw(
    text: string,
    x: number,
    y: number,
    size: number,
    bold: boolean,
    italic: boolean,
    color: [number, number, number],
  ): void {
    const clean = this.sanitise(text);
    if (!clean) return;
    const { font, fake } = this.fontFor(clean, bold, italic);
    const options = { x, y, size, font, color: rgb(color[0], color[1], color[2]) };
    try {
      this.page.drawText(clean, options);
      if (fake) this.page.drawText(clean, { ...options, x: x + size * 0.035 });
    } catch {
      const fallback = clean.replace(/[^\x20-\x7e]/g, "?");
      if (!fallback.trim()) return;
      this.page.drawText(fallback, { ...options, font: this.fonts.latin });
    }
  }

  /** Word-wrap a single string into lines fitting `maxWidth`. */
  wrap(text: string, size: number, maxWidth: number, bold = false, italic = false): string[] {
    const source = text.replace(/\t/g, "    ");
    if (!source.trim()) return [""];
    const words = source.split(/(\s+)/).filter((w) => w !== "");
    const lines: string[] = [];
    let current = "";

    const push = () => {
      if (current.trim()) lines.push(current.replace(/\s+$/, ""));
      current = "";
    };

    for (const word of words) {
      if (/^\s+$/.test(word)) {
        if (current) current += " ";
        continue;
      }
      const candidate = current + word;
      if (this.widthOf(candidate, size, bold, italic) <= maxWidth) {
        current = candidate;
        continue;
      }
      push();
      if (this.widthOf(word, size, bold, italic) <= maxWidth) {
        current = word;
      } else {
        let chunk = "";
        for (const ch of word) {
          if (this.widthOf(chunk + ch, size, bold, italic) > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      }
    }
    push();
    return lines.length ? lines : [""];
  }

  /** Draw a wrapped paragraph and advance the cursor. */
  paragraph(
    text: string,
    options: {
      size?: number;
      bold?: boolean;
      italic?: boolean;
      lineGap?: number;
      spaceAfter?: number;
      indent?: number;
      align?: "left" | "center" | "right";
      color?: [number, number, number];
    } = {},
  ): void {
    const rtl = RTL_RE.test(text);
    // Naskh has a much smaller apparent x-height than Latin faces, so Urdu /
    // Arabic runs are scaled up a little to stay comfortably readable.
    const size = (options.size ?? 11) * (rtl ? 1.25 : 1);
    const bold = options.bold ?? false;
    const italic = options.italic ?? false;
    const indent = options.indent ?? 0;
    const color = options.color ?? [0.1, 0.12, 0.15];
    const lineHeight = size * (options.lineGap ?? (rtl ? 1.7 : 1.45));
    const align = options.align ?? (rtl ? "right" : "left");
    const maxWidth = this.contentWidth - indent;

    if (!text.trim()) {
      this.moveDown(lineHeight * 0.6);
      return;
    }

    for (const line of this.wrap(text, size, maxWidth, bold, italic)) {
      const visual = shapeRtl(line);
      const w = this.widthOf(visual, size, bold, italic);
      let x = this.margin + indent;
      if (align === "center") x = this.margin + indent + (maxWidth - w) / 2;
      else if (align === "right") x = this.margin + indent + (maxWidth - w);

      this.ensure(lineHeight);
      this.y -= lineHeight;
      this.drawRaw(visual, x, this.y, size, bold, italic, color);
    }

    if (options.spaceAfter) this.moveDown(options.spaceAfter);
  }

  rule(color: [number, number, number] = [0.85, 0.87, 0.9]): void {
    this.ensure(10);
    this.y -= 6;
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.width - this.margin, y: this.y },
      thickness: 0.7,
      color: rgb(color[0], color[1], color[2]),
    });
    this.y -= 6;
  }

  /** Draw a simple grid table with automatic column widths and pagination. */
  table(
    rows: string[][],
    options: { headerRow?: boolean; size?: number; widths?: number[] } = {},
  ): void {
    if (rows.length === 0) return;
    const size = options.size ?? 9.5;
    const padding = 5;
    const columns = Math.max(...rows.map((r) => r.length));
    const normalised = rows.map((r) => {
      const copy = [...r];
      while (copy.length < columns) copy.push("");
      return copy;
    });

    let widths = options.widths;
    if (!widths || widths.length !== columns) {
      const natural = new Array(columns).fill(0);
      for (const row of normalised) {
        row.forEach((cell, i) => {
          natural[i] = Math.max(
            natural[i],
            Math.min(this.widthOf(cell, size) + padding * 2, this.contentWidth * 0.55),
          );
        });
      }
      const total = natural.reduce((a, b) => a + b, 0) || 1;
      widths = natural.map((w) => Math.max(28, (w / total) * this.contentWidth));
      const scale = this.contentWidth / widths.reduce((a, b) => a + b, 0);
      widths = widths.map((w) => w * scale);
    }

    const drawRow = (cells: string[], isHeader: boolean) => {
      const wrapped = cells.map((cell, i) =>
        this.wrap(String(cell ?? ""), size, widths![i] - padding * 2),
      );
      const lineHeight = size * 1.35;
      const rowHeight = Math.max(...wrapped.map((w) => w.length)) * lineHeight + padding * 2;

      if (this.y - rowHeight < this.margin) this.newPage();
      const top = this.y;

      if (isHeader) {
        this.page.drawRectangle({
          x: this.margin,
          y: top - rowHeight,
          width: this.contentWidth,
          height: rowHeight,
          color: rgb(0.93, 0.95, 0.98),
        });
      }

      let x = this.margin;
      wrapped.forEach((lines, i) => {
        this.page.drawRectangle({
          x,
          y: top - rowHeight,
          width: widths![i],
          height: rowHeight,
          borderColor: rgb(0.78, 0.81, 0.85),
          borderWidth: 0.6,
        });
        lines.forEach((line, li) => {
          const visual = shapeRtl(line);
          const rtl = RTL_RE.test(line);
          const textWidth = this.widthOf(visual, size, isHeader);
          const cx = rtl ? x + widths![i] - padding - textWidth : x + padding;
          this.drawRaw(
            visual,
            cx,
            top - padding - lineHeight * (li + 1) + lineHeight * 0.3,
            size,
            isHeader,
            false,
            [0.1, 0.12, 0.15],
          );
        });
        x += widths![i];
      });

      this.y = top - rowHeight;
    };

    normalised.forEach((row, index) => drawRow(row, index === 0 && !!options.headerRow));
    this.moveDown(10);
  }

  async drawImageFullPage(
    bytes: Buffer,
    kind: "png" | "jpg",
    fit: "fit" | "exact",
    margin: number,
  ): Promise<void> {
    const image =
      kind === "png" ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);

    if (fit === "exact") {
      const page = this.doc.addPage([
        image.width + margin * 2,
        image.height + margin * 2,
      ]);
      page.drawImage(image, {
        x: margin,
        y: margin,
        width: image.width,
        height: image.height,
      });
      return;
    }

    const page = this.doc.addPage([this.width, this.height]);
    const boxW = this.width - margin * 2;
    const boxH = this.height - margin * 2;
    const scale = Math.min(boxW / image.width, boxH / image.height, 1);
    const w = image.width * scale;
    const h = image.height * scale;
    page.drawImage(image, {
      x: (this.width - w) / 2,
      y: (this.height - h) / 2,
      width: w,
      height: h,
    });
  }

  /** Remove the implicit first page when a converter only added its own pages. */
  dropFirstPageIfEmpty(): void {
    if (this.doc.getPageCount() > 1 && this.y === this.height - this.margin) {
      const pages = this.doc.getPages();
      if (pages[0] === this.page) this.doc.removePage(0);
    }
  }

  async save(): Promise<Buffer> {
    if (this.doc.getPageCount() === 0) this.newPage();
    return Buffer.from(await this.doc.save({ useObjectStreams: true }));
  }
}
