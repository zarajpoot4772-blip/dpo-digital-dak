import { PDFDocument, degrees } from "pdf-lib";
import { zipSync } from "fflate";
import {
  ConvertError,
  ConvertInput,
  ConvertOutput,
  Options,
  baseName,
  num,
  parseRange,
} from "./types";

function assertPdf(input: ConvertInput): void {
  if (input.bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new ConvertError(`"${input.name}" does not look like a valid PDF file.`);
  }
}

async function load(input: ConvertInput): Promise<PDFDocument> {
  assertPdf(input);
  try {
    return await PDFDocument.load(input.bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
  } catch (error) {
    throw new ConvertError(
      `"${input.name}" could not be opened. It may be password protected or damaged.`,
    );
  }
}

export async function mergePdf(inputs: ConvertInput[]): Promise<ConvertOutput> {
  if (inputs.length < 2) {
    throw new ConvertError("Select at least two PDF files to merge.");
  }

  const merged = await PDFDocument.create();
  let pages = 0;

  for (const input of inputs) {
    const doc = await load(input);
    const copied = await merged.copyPages(doc, doc.getPageIndices());
    copied.forEach((page) => merged.addPage(page));
    pages += copied.length;
  }

  merged.setTitle("Merged document");
  merged.setProducer("File Converter Hub");

  return {
    buffer: Buffer.from(await merged.save({ useObjectStreams: true })),
    filename: "merged.pdf",
    contentType: "application/pdf",
    note: `${inputs.length} files joined — ${pages} pages in total.`,
  };
}

export async function splitPdf(
  input: ConvertInput,
  options: Options,
): Promise<ConvertOutput> {
  const doc = await load(input);
  const total = doc.getPageCount();
  const stem = baseName(input.name);

  if ((options.mode ?? "range") === "each") {
    const files: Record<string, Uint8Array> = {};
    const pad = String(total).length;
    for (let i = 0; i < total; i++) {
      const out = await PDFDocument.create();
      const [page] = await out.copyPages(doc, [i]);
      out.addPage(page);
      files[`${stem}-page-${String(i + 1).padStart(pad, "0")}.pdf`] =
        await out.save({ useObjectStreams: true });
    }
    return {
      buffer: Buffer.from(zipSync(files, { level: 6 })),
      filename: `${stem}-pages.zip`,
      contentType: "application/zip",
      note: `Split into ${total} single-page PDFs.`,
    };
  }

  const indexes = parseRange(options.range ?? "", total);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(doc, indexes);
  copied.forEach((page) => out.addPage(page));

  return {
    buffer: Buffer.from(await out.save({ useObjectStreams: true })),
    filename: `${stem}-extract.pdf`,
    contentType: "application/pdf",
    note: `${indexes.length} of ${total} pages extracted.`,
  };
}

export async function rotatePdf(
  input: ConvertInput,
  options: Options,
): Promise<ConvertOutput> {
  const doc = await load(input);
  const total = doc.getPageCount();
  const angle = [90, 180, 270].includes(num(options, "angle", 90))
    ? num(options, "angle", 90)
    : 90;
  const indexes = parseRange(options.range ?? "", total);
  const pages = doc.getPages();

  for (const index of indexes) {
    const page = pages[index];
    const current = page.getRotation().angle ?? 0;
    page.setRotation(degrees((current + angle) % 360));
  }

  return {
    buffer: Buffer.from(await doc.save({ useObjectStreams: true })),
    filename: `${baseName(input.name)}-rotated.pdf`,
    contentType: "application/pdf",
    note: `${indexes.length} page(s) rotated by ${angle}°.`,
  };
}

const LEVELS: Record<string, { quality: number; maxEdge: number }> = {
  light: { quality: 82, maxEdge: 2400 },
  medium: { quality: 68, maxEdge: 1700 },
  strong: { quality: 50, maxEdge: 1200 },
};

/**
 * Re-encode every embedded raster image at a lower quality, drop metadata and
 * rewrite the file with cross-reference/object streams. Vector artwork and text
 * are untouched, so the document stays sharp and selectable.
 */
export async function compressPdf(
  input: ConvertInput,
  options: Options,
): Promise<ConvertOutput> {
  const sharp = (await import("sharp")).default;
  const { PDFName, PDFRawStream, decodePDFRawStream } = await import("pdf-lib");

  const level = LEVELS[options.level ?? "medium"] ?? LEVELS.medium;
  const doc = await load(input);
  const original = input.bytes.length;

  doc.setTitle("");
  doc.setAuthor("");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setProducer("File Converter Hub");
  doc.setCreator("File Converter Hub");

  const context = doc.context;
  let recompressed = 0;

  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;

    const dict = object.dict;
    const subtype = dict.lookup(PDFName.of("Subtype"));
    if (!subtype || String(subtype) !== "/Image") continue;
    // Transparency/stencil masks reference the exact sample layout - skip them.
    if (dict.lookup(PDFName.of("SMask")) || dict.lookup(PDFName.of("Mask"))) continue;
    if (dict.lookup(PDFName.of("Decode"))) continue;

    const filter = String(dict.lookup(PDFName.of("Filter")) ?? "");
    const width = Number(String(dict.lookup(PDFName.of("Width")) ?? 0));
    const height = Number(String(dict.lookup(PDFName.of("Height")) ?? 0));
    const bits = Number(String(dict.lookup(PDFName.of("BitsPerComponent")) ?? 8));
    const colorSpace = String(dict.lookup(PDFName.of("ColorSpace")) ?? "");
    if (!width || !height) continue;

    let source: Buffer | null = null;
    let channels: 1 | 3 | null = null;

    try {
      if (filter.includes("DCTDecode")) {
        source = Buffer.from(object.getContents());
      } else if (filter.includes("FlateDecode") && bits === 8) {
        if (colorSpace === "/DeviceRGB") channels = 3;
        else if (colorSpace === "/DeviceGray") channels = 1;
        else continue;
        source = Buffer.from(decodePDFRawStream(object).decode());
        if (source.length < width * height * channels) continue;
      } else {
        continue;
      }
    } catch {
      continue;
    }

    if (!source || source.length < 20 * 1024) continue;

    try {
      const pipeline = channels
        ? sharp(source, { raw: { width, height, channels } })
        : sharp(source).rotate();

      const longest = Math.max(width, height);
      const resized =
        longest > level.maxEdge
          ? pipeline.resize({
              width: width >= height ? level.maxEdge : undefined,
              height: height > width ? level.maxEdge : undefined,
              fit: "inside",
              withoutEnlargement: true,
            })
          : pipeline;

      const next = await resized
        .jpeg({ quality: level.quality, mozjpeg: true, chromaSubsampling: "4:2:0" })
        .toBuffer();

      if (next.length >= source.length * 0.9) continue;
      const meta = await sharp(next).metadata();

      const nextDict = dict.clone(context);
      nextDict.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
      nextDict.set(PDFName.of("Width"), context.obj(meta.width ?? width));
      nextDict.set(PDFName.of("Height"), context.obj(meta.height ?? height));
      nextDict.set(PDFName.of("BitsPerComponent"), context.obj(8));
      nextDict.set(
        PDFName.of("ColorSpace"),
        PDFName.of(meta.channels === 1 ? "DeviceGray" : "DeviceRGB"),
      );
      nextDict.set(PDFName.of("Length"), context.obj(next.length));
      nextDict.delete(PDFName.of("DecodeParms"));

      context.assign(ref, PDFRawStream.of(nextDict, new Uint8Array(next)));
      recompressed++;
    } catch {
      /* leave this image untouched */
    }
  }

  const buffer = Buffer.from(
    await doc.save({ useObjectStreams: true, addDefaultPage: false }),
  );
  const saved = original - buffer.length;
  const percent = original > 0 ? Math.round((saved / original) * 100) : 0;

  return {
    buffer: saved > 0 ? buffer : input.bytes,
    filename: `${baseName(input.name)}-compressed.pdf`,
    contentType: "application/pdf",
    note:
      saved > 0
        ? `${formatBytes(original)} → ${formatBytes(buffer.length)} (${percent}% smaller; ${recompressed} image${recompressed === 1 ? "" : "s"} re-encoded).`
        : `This PDF is already well optimised (${formatBytes(original)}) — the original is returned unchanged.`,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
