#!/usr/bin/env node
/**
 * Live smoke test for every conversion endpoint.
 *
 *   npm run dev          # in one terminal
 *   npm run test:smoke   # in another
 *
 * Set BASE_URL to point at a deployed instance instead of localhost:3100.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import ExcelJS from "exceljs";
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  HeadingLevel,
  WidthType,
} from "docx";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3100";
const SKIP_OCR = process.env.SKIP_OCR === "1";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "converter-smoke-"));
let passed = 0;
let failed = 0;

async function buildFixtures() {
  // --- a small text PDF with a table-ish layout
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let p = 1; p <= 2; p++) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`Quarterly Report — Page ${p}`, { x: 50, y: 780, size: 20, font: bold });
    page.drawText("A sample paragraph used to validate text extraction.", {
      x: 50,
      y: 740,
      size: 11,
      font,
    });
    const rows = [
      ["Item", "Qty", "Price"],
      ["Pencil", "10", "25.00"],
      ["Notebook", "3", "150.50"],
    ];
    rows.forEach((row, i) => {
      page.drawText(row[0], { x: 50, y: 690 - i * 20, size: 11, font: i ? font : bold });
      page.drawText(row[1], { x: 250, y: 690 - i * 20, size: 11, font: i ? font : bold });
      page.drawText(row[2], { x: 380, y: 690 - i * 20, size: 11, font: i ? font : bold });
    });
  }
  await fs.writeFile(path.join(dir, "sample.pdf"), await pdf.save());

  // --- a PDF carrying a large JPEG so compression has something to chew on
  const photo = await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: { r: 110, g: 150, b: 90 } },
  })
    .jpeg({ quality: 100 })
    .toBuffer();
  const heavy = await PDFDocument.create();
  const embedded = await heavy.embedJpg(photo);
  heavy.addPage([842, 595]).drawImage(embedded, { x: 0, y: 0, width: 842, height: 595 });
  await fs.writeFile(path.join(dir, "heavy.pdf"), await heavy.save());

  // --- Word document with headings, a list, a table and Urdu text
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("Annual Office Report")],
          }),
          new Paragraph({
            children: [
              new TextRun("Mixed "),
              new TextRun({ text: "bold", bold: true }),
              new TextRun(" and "),
              new TextRun({ text: "italic", italics: true }),
              new TextRun(" runs plus a long sentence that must wrap."),
            ],
          }),
          new Paragraph({ children: [new TextRun("یہ اردو متن کی جانچ کے لیے ہے۔")] }),
          new Paragraph({ text: "First bullet", bullet: { level: 0 } }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: ["Item", "Qty"].map(
                  (t) =>
                    new TableCell({
                      children: [new Paragraph({ children: [new TextRun({ text: t, bold: true })] })],
                    }),
                ),
              }),
              new TableRow({
                children: ["Pencil", "10"].map(
                  (t) => new TableCell({ children: [new Paragraph(t)] }),
                ),
              }),
            ],
          }),
        ],
      },
    ],
  });
  await fs.writeFile(path.join(dir, "sample.docx"), await Packer.toBuffer(doc));

  // --- workbook with two sheets and a formula
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Budget");
  sheet.addRow(["Department", "Q1", "Q2", "Total"]);
  sheet.addRow(["Operations", 1200, 1400, { formula: "SUM(B2:C2)", result: 2600 }]);
  sheet.addRow(["Logistics", 800, 760, { formula: "SUM(B3:C3)", result: 1560 }]);
  workbook.addWorksheet("Notes").addRow(["Second sheet"]);
  await workbook.xlsx.writeFile(path.join(dir, "sample.xlsx"));

  await fs.writeFile(path.join(dir, "sample.csv"), 'Name,Role\n"Ali, A.",Clerk\nSara,Officer\n');
  await fs.writeFile(
    path.join(dir, "sample.txt"),
    Array.from({ length: 40 }, (_, i) => `Line ${i + 1}: the quick brown fox.`).join("\n"),
  );

  await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 40, g: 90, b: 200 } } })
    .jpeg()
    .toFile(path.join(dir, "a.jpg"));
  await sharp({ create: { width: 800, height: 1200, channels: 4, background: { r: 230, g: 80, b: 40, alpha: 1 } } })
    .png()
    .toFile(path.join(dir, "b.png"));
}

async function check(label, tool, files, options = {}, expect = {}) {
  const body = new FormData();
  for (const file of files) {
    const bytes = await fs.readFile(path.join(dir, file));
    body.append("files", new Blob([bytes]), file);
  }
  for (const [key, value] of Object.entries(options)) body.append(key, String(value));

  try {
    const response = await fetch(`${BASE_URL}/api/convert/${tool}`, {
      method: "POST",
      body,
    });

    if (expect.status && response.status !== expect.status) {
      throw new Error(`expected HTTP ${expect.status}, got ${response.status}`);
    }
    if (!expect.status) {
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(`HTTP ${response.status} — ${payload.error ?? "unknown error"}`);
      }
      const blob = await response.blob();
      if (blob.size < (expect.minBytes ?? 200)) {
        throw new Error(`output is suspiciously small (${blob.size} bytes)`);
      }
      const type = response.headers.get("Content-Type") ?? "";
      if (expect.contentType && !type.startsWith(expect.contentType)) {
        throw new Error(`expected ${expect.contentType}, got ${type}`);
      }
      const note = decodeURIComponent(response.headers.get("X-Convert-Note") ?? "");
      console.log(`  ok   ${label.padEnd(26)} ${String(blob.size).padStart(8)} B  ${note}`);
    } else {
      console.log(`  ok   ${label.padEnd(26)} rejected with HTTP ${response.status}`);
    }
    passed++;
  } catch (error) {
    console.log(`  FAIL ${label.padEnd(26)} ${error.message}`);
    failed++;
  }
}

console.log(`\nFile Converter Hub smoke test → ${BASE_URL}\n`);
await buildFixtures();

const PDF = "application/pdf";
const ZIP = "application/zip";

await check("pdf-to-word", "pdf-to-word", ["sample.pdf"], { pageBreaks: true }, {
  contentType: "application/vnd.openxmlformats",
});
await check("pdf-to-excel", "pdf-to-excel", ["sample.pdf"], { sheetMode: "per-page" }, {
  contentType: "application/vnd.openxmlformats",
});
await check("pdf-to-text", "pdf-to-text", ["sample.pdf"], {}, { contentType: "text/plain" });
await check("pdf-to-jpg", "pdf-to-jpg", ["sample.pdf"], { dpi: 150, quality: 85 }, { contentType: ZIP });
await check("pdf-to-png", "pdf-to-png", ["sample.pdf"], { dpi: 96 }, { contentType: ZIP });
await check("word-to-pdf", "word-to-pdf", ["sample.docx"], { pageSize: "A4" }, { contentType: PDF });
await check("excel-to-pdf", "excel-to-pdf", ["sample.xlsx"], { orientation: "landscape" }, { contentType: PDF });
await check("csv-to-pdf", "excel-to-pdf", ["sample.csv"], { orientation: "portrait" }, { contentType: PDF });
await check("text-to-pdf", "text-to-pdf", ["sample.txt"], { fontSize: 11 }, { contentType: PDF });
await check("image-to-pdf", "image-to-pdf", ["a.jpg", "b.png"], { fit: "fit", margin: 20 }, { contentType: PDF });
await check("merge-pdf", "merge-pdf", ["sample.pdf", "heavy.pdf"], {}, { contentType: PDF });
await check("split-pdf (range)", "split-pdf", ["sample.pdf"], { mode: "range", range: "2" }, { contentType: PDF });
await check("split-pdf (each)", "split-pdf", ["sample.pdf"], { mode: "each" }, { contentType: ZIP });
await check("rotate-pdf", "rotate-pdf", ["sample.pdf"], { angle: 90 }, { contentType: PDF });
await check("compress-pdf", "compress-pdf", ["heavy.pdf"], { level: "medium" }, { contentType: PDF });
await check("image-convert", "image-convert", ["a.jpg"], { format: "webp", quality: 85 }, { contentType: "image/webp" });
await check("compress-image", "compress-image", ["a.jpg", "b.png"], { quality: 70, maxWidth: 800 }, { contentType: ZIP });

if (!SKIP_OCR) {
  await check("ocr-pdf", "ocr-pdf", ["sample.pdf"], { lang: "eng", maxPages: 1 }, {
    contentType: "text/plain",
    minBytes: 20,
  });
}

// --- rejection paths
await check("reject wrong type", "pdf-to-word", ["sample.docx"], {}, { status: 400 });
await check("reject single merge", "merge-pdf", ["sample.pdf"], {}, { status: 400 });
await check("reject bad range", "split-pdf", ["sample.pdf"], { mode: "range", range: "40-50" }, { status: 400 });
await check("reject unknown tool", "not-a-tool", ["sample.pdf"], {}, { status: 404 });

await fs.rm(dir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
