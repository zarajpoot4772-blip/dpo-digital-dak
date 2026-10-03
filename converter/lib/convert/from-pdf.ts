import { zipSync } from "fflate";
import {
  ConvertError,
  ConvertInput,
  ConvertOutput,
  Options,
  baseName,
  bool,
  num,
} from "./types";
import { extractPdfText, openPdf, renderPdfPage, type PdfPageText } from "./pdfjs";
import { recognise } from "./ocr-engine";

/* eslint-disable @typescript-eslint/no-explicit-any */

function assertPdf(input: ConvertInput): void {
  if (input.bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new ConvertError(`"${input.name}" does not look like a valid PDF file.`);
  }
}

function hasText(pages: PdfPageText[]): boolean {
  return pages.some((p) => p.lines.some((l) => l.text.trim().length > 0));
}

// --------------------------------------------------------------- PDF → DOCX

/** Classify a line so the Word output gets real headings instead of flat text. */
function headingLevel(fontSize: number, bodySize: number, bold: boolean): 1 | 2 | 3 | null {
  const ratio = fontSize / (bodySize || fontSize);
  if (ratio >= 1.6) return 1;
  if (ratio >= 1.32) return 2;
  if (ratio >= 1.15 && bold) return 3;
  return null;
}

export async function pdfToWord(
  input: ConvertInput,
  options: Options,
): Promise<ConvertOutput> {
  assertPdf(input);
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    PageBreak,
  } = await import("docx");

  const pages = await extractPdfText(input.bytes);
  if (!hasText(pages)) {
    throw new ConvertError(
      "No selectable text was found — this PDF looks like a scan. Use the OCR tool instead.",
    );
  }

  // Most common font size across the document = body text size.
  const counts = new Map<number, number>();
  for (const page of pages) {
    for (const line of page.lines) {
      const key = Math.round(line.fontSize * 2) / 2;
      counts.set(key, (counts.get(key) ?? 0) + line.text.length);
    }
  }
  const bodySize =
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;

  const keepBreaks = bool(options, "pageBreaks", true);
  const children: any[] = [];

  pages.forEach((page, pageIndex) => {
    const lines = page.lines;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const text = line.text.trim();
      if (!text) continue;

      const level = headingLevel(line.fontSize, bodySize, line.bold);
      const centred =
        Math.abs(line.x - (page.width - line.x - lineWidth(line)) ) < page.width * 0.08 &&
        line.x > page.width * 0.18;

      if (level) {
        children.push(
          new Paragraph({
            heading:
              level === 1
                ? HeadingLevel.HEADING_1
                : level === 2
                  ? HeadingLevel.HEADING_2
                  : HeadingLevel.HEADING_3,
            alignment: centred ? AlignmentType.CENTER : AlignmentType.LEFT,
            children: [new TextRun({ text, bold: true })],
          }),
        );
        continue;
      }

      // Merge soft-wrapped lines belonging to the same paragraph.
      let paragraphText = text;
      let last = line;
      while (
        i + 1 < lines.length &&
        !/[.!?:;।۔]$/.test(paragraphText.trim()) &&
        lines[i + 1].text.trim() &&
        Math.abs(lines[i + 1].fontSize - last.fontSize) < 0.8 &&
        lines[i + 1].y - last.y < last.fontSize * 2.1 &&
        !headingLevel(lines[i + 1].fontSize, bodySize, lines[i + 1].bold) &&
        lines[i + 1].cells.length === 1 &&
        line.cells.length === 1
      ) {
        i++;
        last = lines[i];
        paragraphText += " " + lines[i].text.trim();
      }

      const bullet = /^[•◦▪·\-–*]\s+/.test(paragraphText);
      children.push(
        new Paragraph({
          alignment: centred ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { after: 120 },
          bullet: bullet ? { level: 0 } : undefined,
          children: [
            new TextRun({
              text: bullet ? paragraphText.replace(/^[•◦▪·\-–*]\s+/, "") : paragraphText,
              bold: line.bold,
              size: Math.round(Math.max(8, Math.min(line.fontSize, 36)) * 2),
            }),
          ],
        }),
      );
    }

    if (keepBreaks && pageIndex < pages.length - 1) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
  });

  const doc = new Document({
    creator: "File Converter Hub",
    title: baseName(input.name),
    sections: [{ properties: {}, children }],
  });

  const buffer = Buffer.from(await Packer.toBuffer(doc));
  return {
    buffer,
    filename: `${baseName(input.name)}.docx`,
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    note: `${pages.length} page${pages.length === 1 ? "" : "s"} converted to Word.`,
  };
}

function lineWidth(line: { items: { x: number; width: number }[] }): number {
  if (line.items.length === 0) return 0;
  const last = line.items[line.items.length - 1];
  return last.x + last.width - line.items[0].x;
}

// --------------------------------------------------------------- PDF → XLSX

export async function pdfToExcel(
  input: ConvertInput,
  options: Options,
): Promise<ConvertOutput> {
  assertPdf(input);
  const ExcelJS = (await import("exceljs")).default;

  const pages = await extractPdfText(input.bytes);
  if (!hasText(pages)) {
    throw new ConvertError(
      "No selectable text was found — this PDF looks like a scan. Use the OCR tool first.",
    );
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "File Converter Hub";
  workbook.created = new Date();

  const single = options.sheetMode === "single";
  const sharedSheet = single ? workbook.addWorksheet("Extracted data") : null;
  let rowCount = 0;

  for (const page of pages) {
    const sheet =
      sharedSheet ?? workbook.addWorksheet(`Page ${page.pageNumber}`.slice(0, 31));

    if (sharedSheet && page.pageNumber > 1) {
      sharedSheet.addRow([]);
      sharedSheet.addRow([`— Page ${page.pageNumber} —`]);
    }

    for (const line of page.lines) {
      if (!line.cells.some((c) => c.trim())) continue;
      const row = sheet.addRow(
        line.cells.map((cell) => {
          const clean = cell.trim();
          const numeric = clean.replace(/[,\s]/g, "");
          if (/^-?\d+(\.\d+)?%$/.test(numeric)) return clean;
          if (/^-?\d+(\.\d+)?$/.test(numeric) && numeric.length < 16) {
            return Number(numeric);
          }
          return clean;
        }),
      );
      if (line.bold) row.font = { bold: true };
      rowCount++;
    }

    const widths = new Map<number, number>();
    sheet.eachRow((row) => {
      row.eachCell((cell, col) => {
        const length = String(cell.value ?? "").length;
        widths.set(col, Math.max(widths.get(col) ?? 10, Math.min(length + 2, 60)));
      });
    });
    widths.forEach((width, col) => {
      sheet.getColumn(col).width = width;
    });
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    buffer,
    filename: `${baseName(input.name)}.xlsx`,
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    note: `${rowCount} rows extracted from ${pages.length} page${pages.length === 1 ? "" : "s"}.`,
  };
}

// ---------------------------------------------------------------- PDF → TXT

export async function pdfToText(input: ConvertInput): Promise<ConvertOutput> {
  assertPdf(input);
  const pages = await extractPdfText(input.bytes);
  if (!hasText(pages)) {
    throw new ConvertError(
      "No selectable text was found — this PDF looks like a scan. Use the OCR tool instead.",
    );
  }

  const parts: string[] = [];
  for (const page of pages) {
    if (pages.length > 1) parts.push(`===== Page ${page.pageNumber} =====`);
    for (const line of page.lines) parts.push(line.cells.join("\t"));
    parts.push("");
  }

  const text = parts.join("\n");
  return {
    buffer: Buffer.from("\uFEFF" + text, "utf8"),
    filename: `${baseName(input.name)}.txt`,
    contentType: "text/plain; charset=utf-8",
    note: `${text.length.toLocaleString()} characters extracted.`,
  };
}

// -------------------------------------------------------------- PDF → image

export async function pdfToImages(
  input: ConvertInput,
  options: Options,
  format: "jpeg" | "png",
): Promise<ConvertOutput> {
  assertPdf(input);
  const sharp = (await import("sharp")).default;

  const dpi = Math.max(72, Math.min(num(options, "dpi", 150), 300));
  const quality = Math.max(40, Math.min(num(options, "quality", 90), 100));
  const stem = baseName(input.name);

  const doc = await openPdf(input.bytes);
  const total: number = doc.numPages;
  if (total > 200) {
    throw new ConvertError("This PDF has more than 200 pages — please split it first.");
  }

  const files: { name: string; data: Uint8Array }[] = [];
  try {
    for (let page = 1; page <= total; page++) {
      const { png } = await renderPdfPage(doc, page, dpi);
      const pipeline = sharp(png);
      const data =
        format === "jpeg"
          ? await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true }).toBuffer()
          : await pipeline.png({ compressionLevel: 9 }).toBuffer();
      const suffix = String(page).padStart(String(total).length, "0");
      files.push({
        name: `${stem}-page-${suffix}.${format === "jpeg" ? "jpg" : "png"}`,
        data: new Uint8Array(data),
      });
    }
  } finally {
    await doc.destroy().catch(() => {});
  }

  if (files.length === 1) {
    return {
      buffer: Buffer.from(files[0].data),
      filename: files[0].name,
      contentType: format === "jpeg" ? "image/jpeg" : "image/png",
      note: `Rendered 1 page at ${dpi} DPI.`,
    };
  }

  const archive = zipSync(
    Object.fromEntries(files.map((f) => [f.name, f.data])),
    { level: format === "png" ? 6 : 0 },
  );
  return {
    buffer: Buffer.from(archive),
    filename: `${stem}-${format === "jpeg" ? "jpg" : "png"}.zip`,
    contentType: "application/zip",
    note: `Rendered ${files.length} pages at ${dpi} DPI.`,
  };
}

// ----------------------------------------------------------------- OCR

export async function ocrToText(
  input: ConvertInput,
  options: Options,
): Promise<ConvertOutput> {
  const lang = ["eng", "urd", "eng+urd"].includes(options.lang ?? "")
    ? options.lang
    : "eng";
  const maxPages = Math.max(1, Math.min(num(options, "maxPages", 5), 20));
  const sharp = (await import("sharp")).default;

  const images: Buffer[] = [];
  const isPdf = input.bytes.subarray(0, 5).toString("ascii") === "%PDF-";

  if (isPdf) {
    const doc = await openPdf(input.bytes);
    try {
      const pages = Math.min(doc.numPages, maxPages);
      for (let p = 1; p <= pages; p++) {
        const { png } = await renderPdfPage(doc, p, 200);
        images.push(png);
      }
    } finally {
      await doc.destroy().catch(() => {});
    }
  } else {
    images.push(
      await sharp(input.bytes).flatten({ background: "#ffffff" }).png().toBuffer(),
    );
  }

  if (images.length === 0) throw new ConvertError("Nothing to scan in this file.");

  const prepared: Buffer[] = [];
  for (const image of images) {
    prepared.push(
      await sharp(image).grayscale().normalise().sharpen().png().toBuffer(),
    );
  }

  let pageTexts: string[];
  try {
    pageTexts = await recognise(prepared, lang!);
  } catch (error) {
    throw new ConvertError(
      error instanceof Error ? error.message : "OCR could not be completed.",
      500,
    );
  }

  const chunks: string[] = [];
  pageTexts.forEach((pageText, index) => {
    if (pageTexts.length > 1) chunks.push(`===== Page ${index + 1} =====`);
    chunks.push(pageText);
    chunks.push("");
  });

  const text = chunks.join("\n").trim();
  if (!text) {
    throw new ConvertError(
      "OCR finished but found no readable text. Try a higher quality scan.",
    );
  }

  return {
    buffer: Buffer.from("\uFEFF" + text, "utf8"),
    filename: `${baseName(input.name)}-ocr.txt`,
    contentType: "text/plain; charset=utf-8",
    note: `OCR read ${images.length} page${images.length === 1 ? "" : "s"} (${lang}).`,
  };
}
