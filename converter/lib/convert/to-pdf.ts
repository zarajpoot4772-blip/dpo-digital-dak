import {
  ConvertError,
  ConvertInput,
  ConvertOutput,
  Options,
  baseName,
  num,
} from "./types";
import { PdfWriter, RTL_RE } from "./pdf-writer";

/* eslint-disable @typescript-eslint/no-explicit-any */

const DOCX_MAGIC = [0x50, 0x4b, 0x03, 0x04];

// ---------------------------------------------------------------- DOCX → PDF

export async function wordToPdf(
  input: ConvertInput,
  options: Options,
): Promise<ConvertOutput> {
  if (!DOCX_MAGIC.every((b, i) => input.bytes[i] === b)) {
    throw new ConvertError(
      `"${input.name}" is not a valid .docx file. Old .doc files must be saved as .docx first.`,
    );
  }

  const mammoth = (await import("mammoth")).default;
  const { parse } = await import("node-html-parser");

  const result = await mammoth.convertToHtml(
    { buffer: input.bytes },
    {
      convertImage: mammoth.images.imgElement(async (image: any) => {
        const buffer: Buffer = await image.read("base64").then((b: string) => b);
        return { src: `data:${image.contentType};base64,${buffer}` };
      }),
    },
  );

  const html = result.value || "";
  const root = parse(html, {
    lowerCaseTagName: true,
    comment: false,
    blockTextElements: { script: false, noscript: false, style: false },
  });

  const writer = await PdfWriter.create({
    pageSize: options.pageSize ?? "A4",
    margin: 54,
    rtl: RTL_RE.test(html),
  });

  const HEADING_SIZES: Record<string, number> = {
    h1: 21,
    h2: 17,
    h3: 14.5,
    h4: 12.5,
    h5: 11.5,
    h6: 11,
  };

  const textOf = (node: any): string =>
    String(node.text ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const walkImages: { data: Buffer; mime: string }[] = [];

  const renderBlock = async (node: any, depth = 0): Promise<void> => {
    const tag = String(node.rawTagName ?? "").toLowerCase();

    switch (tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const text = textOf(node);
        if (!text) return;
        writer.moveDown(6);
        writer.paragraph(text, {
          size: HEADING_SIZES[tag],
          bold: true,
          spaceAfter: 4,
          color: [0.08, 0.12, 0.2],
        });
        return;
      }
      case "p": {
        const img = node.querySelector("img");
        if (img) await renderImage(img);
        const text = textOf(node);
        if (!text) {
          if (!img) writer.moveDown(6);
          return;
        }
        const bold = !!node.querySelector("strong,b") && textOf(node.querySelector("strong,b")) === text;
        const italic = !!node.querySelector("em,i") && textOf(node.querySelector("em,i")) === text;
        writer.paragraph(text, { size: 11, bold, italic, spaceAfter: 3 });
        return;
      }
      case "ul":
      case "ol": {
        const items = node.querySelectorAll("> li");
        let index = 1;
        for (const li of items) {
          const text = textOf(li);
          if (!text) continue;
          const marker = tag === "ol" ? `${index}.` : "•";
          writer.paragraph(`${marker}  ${text}`, {
            size: 11,
            indent: 16 + depth * 14,
            spaceAfter: 1,
          });
          index++;
          for (const nested of li.querySelectorAll("> ul, > ol")) {
            await renderBlock(nested, depth + 1);
          }
        }
        writer.moveDown(5);
        return;
      }
      case "table": {
        const rows: string[][] = [];
        for (const tr of node.querySelectorAll("tr")) {
          rows.push(
            tr.querySelectorAll("th, td").map((cell: any) => textOf(cell)),
          );
        }
        if (rows.length) {
          const hasHeader = !!node.querySelector("th");
          writer.moveDown(4);
          writer.table(rows, { headerRow: hasHeader });
        }
        return;
      }
      case "img": {
        await renderImage(node);
        return;
      }
      case "hr": {
        writer.rule();
        return;
      }
      case "br": {
        writer.moveDown(10);
        return;
      }
      default: {
        if (node.childNodes?.length) {
          for (const child of node.childNodes) {
            if (child.nodeType === 1) await renderBlock(child, depth);
          }
        } else {
          const text = textOf(node);
          if (text) writer.paragraph(text, { size: 11, spaceAfter: 3 });
        }
      }
    }
  };

  const renderImage = async (img: any): Promise<void> => {
    const src = String(img.getAttribute?.("src") ?? "");
    const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(src);
    if (!match) return;
    try {
      const sharp = (await import("sharp")).default;
      const raw = Buffer.from(match[2], "base64");
      const png = await sharp(raw).png().toBuffer();
      const meta = await sharp(png).metadata();
      const maxW = writer.contentWidth;
      const scale = Math.min(maxW / (meta.width || maxW), 1, 360 / (meta.height || 360));
      const w = (meta.width || 100) * scale;
      const h = (meta.height || 100) * scale;
      writer.ensure(h + 12);
      const embedded = await writer.doc.embedPng(png);
      const pages = writer.doc.getPages();
      const page = pages[pages.length - 1];
      writer.moveDown(h + 8);
      page.drawImage(embedded, {
        x: writer.margin,
        y: writer.cursorY + 4,
        width: w,
        height: h,
      });
      walkImages.push({ data: png, mime: "image/png" });
    } catch {
      /* unsupported image, skip */
    }
  };

  const body = root.querySelector("body") ?? root;
  for (const child of body.childNodes) {
    if (child.nodeType === 1) await renderBlock(child);
  }

  if (writer.doc.getPageCount() === 1 && writer.cursorY === writer.height - writer.margin) {
    writer.paragraph("This Word document contained no readable content.", {
      size: 11,
      italic: true,
    });
  }

  const buffer = await writer.save();
  return {
    buffer,
    filename: `${baseName(input.name)}.pdf`,
    contentType: "application/pdf",
    note: `${writer.doc.getPageCount()} page PDF created${walkImages.length ? ` with ${walkImages.length} image(s)` : ""}.`,
  };
}

// ----------------------------------------------------------- XLSX/CSV → PDF

export async function excelToPdf(
  input: ConvertInput,
  options: Options,
): Promise<ConvertOutput> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const isCsv = /\.csv$/i.test(input.name) || input.type === "text/csv";

  if (isCsv) {
    const text = input.bytes.toString("utf8");
    const sheet = workbook.addWorksheet("Sheet1");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      sheet.addRow(parseCsvLine(line));
    }
  } else {
    if (!DOCX_MAGIC.every((b, i) => input.bytes[i] === b)) {
      throw new ConvertError(`"${input.name}" is not a valid .xlsx workbook.`);
    }
    await workbook.xlsx.load(input.bytes as unknown as ArrayBuffer);
  }

  type SheetData = { name: string; rows: string[][] };
  const sheets: SheetData[] = [];

  workbook.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values: string[] = [];
      const count = Math.max(sheet.columnCount, row.cellCount);
      for (let c = 1; c <= count; c++) {
        values.push(cellToString(row.getCell(c).value));
      }
      while (values.length && values[values.length - 1] === "") values.pop();
      if (values.length) rows.push(values);
    });
    if (rows.length) sheets.push({ name: sheet.name, rows });
  });

  const needsRtl = sheets.some((sheet) =>
    sheet.rows.some((row) => row.some((cell) => RTL_RE.test(cell))),
  );

  const writer = await PdfWriter.create({
    pageSize: "A4",
    landscape: (options.orientation ?? "landscape") === "landscape",
    margin: 34,
    rtl: needsRtl,
  });

  let sheetIndex = 0;
  let totalRows = 0;

  for (const { name, rows } of sheets) {
    if (sheetIndex > 0) writer.newPage();
    sheetIndex++;
    totalRows += rows.length;

    writer.paragraph(name, { size: 14, bold: true, spaceAfter: 6 });

    // Very wide sheets are chunked so columns stay readable.
    const columns = Math.max(...rows.map((r) => r.length));
    const perChunk = Math.max(1, Math.min(columns, 12));
    for (let start = 0; start < columns; start += perChunk) {
      const slice = rows.map((r) => r.slice(start, start + perChunk).map((v) => v ?? ""));
      if (start > 0) {
        writer.moveDown(8);
        writer.paragraph(`columns ${start + 1}\u2013${Math.min(start + perChunk, columns)}`, {
          size: 8.5,
          italic: true,
          color: [0.45, 0.47, 0.5],
        });
      }
      writer.table(slice, { headerRow: true, size: 9 });
    }
  }

  if (sheetIndex === 0) {
    writer.paragraph("The workbook has no data rows.", { size: 11, italic: true });
  }

  return {
    buffer: await writer.save(),
    filename: `${baseName(input.name)}.pdf`,
    contentType: "application/pdf",
    note: `${totalRows} rows across ${sheetIndex || 1} sheet(s).`,
  };
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const any = value as any;
    if (typeof any.text === "string") return any.text;
    if (any.richText) return any.richText.map((r: any) => r.text).join("");
    if (any.result !== undefined) return String(any.result);
    if (any.hyperlink) return String(any.text ?? any.hyperlink);
    if (any.formula) return `=${any.formula}`;
    return "";
  }
  return String(value);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out;
}

// ---------------------------------------------------------------- TXT → PDF

export async function textToPdf(
  input: ConvertInput,
  options: Options,
): Promise<ConvertOutput> {
  const size = Math.max(7, Math.min(num(options, "fontSize", 11), 24));
  let text = input.bytes.toString("utf8").replace(/^\uFEFF/, "");
  if (!text.trim()) throw new ConvertError("The file is empty.");
  const LIMIT = 400_000;
  let truncated = false;
  if (text.length > LIMIT) {
    text = text.slice(0, LIMIT);
    truncated = true;
  }

  const writer = await PdfWriter.create({
    pageSize: "A4",
    margin: 54,
    rtl: RTL_RE.test(text),
  });
  writer.paragraph(baseName(input.name), { size: size + 4, bold: true, spaceAfter: 8 });
  writer.rule();
  writer.moveDown(4);

  for (const line of text.split(/\r?\n/)) {
    writer.paragraph(line, { size, lineGap: 1.4, spaceAfter: 0 });
  }

  if (truncated) {
    writer.moveDown(10);
    writer.paragraph(
      `… the document was truncated at ${LIMIT.toLocaleString()} characters.`,
      { size, italic: true, color: [0.5, 0.5, 0.55] },
    );
  }

  return {
    buffer: await writer.save(),
    filename: `${baseName(input.name)}.pdf`,
    contentType: "application/pdf",
    note: `${writer.doc.getPageCount()} page PDF created${truncated ? " (input truncated)" : ""}.`,
  };
}

// -------------------------------------------------------------- image → PDF

export async function imageToPdf(
  inputs: ConvertInput[],
  options: Options,
): Promise<ConvertOutput> {
  if (inputs.length === 0) throw new ConvertError("Select at least one image.");
  const sharp = (await import("sharp")).default;

  const fit = options.fit === "exact" ? "exact" : "fit";
  const margin = Math.max(0, Math.min(num(options, "margin", 20), 120));
  const writer = await PdfWriter.create({ pageSize: "A4", margin: 0 });

  let added = 0;
  for (const input of inputs) {
    try {
      const png = await sharp(input.bytes, { animated: false })
        .rotate()
        .flatten({ background: "#ffffff" })
        .png()
        .toBuffer();
      await writer.drawImageFullPage(png, "png", fit, margin);
      added++;
    } catch {
      throw new ConvertError(`"${input.name}" could not be read as an image.`);
    }
  }

  writer.dropFirstPageIfEmpty();
  if (added === 0) throw new ConvertError("None of the selected images could be read.");

  const stem = inputs.length === 1 ? baseName(inputs[0].name) : "images";
  return {
    buffer: await writer.save(),
    filename: `${stem}.pdf`,
    contentType: "application/pdf",
    note: `${added} image${added === 1 ? "" : "s"} placed in the PDF.`,
  };
}
