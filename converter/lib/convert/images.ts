import { zipSync } from "fflate";
import {
  ConvertError,
  ConvertInput,
  ConvertOutput,
  Options,
  baseName,
  num,
} from "./types";
import { formatBytes } from "./organise";

const EXT: Record<string, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  avif: "avif",
  tiff: "tiff",
};

const MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  tiff: "image/tiff",
};

type Encoded = { name: string; data: Buffer };

async function encode(
  bytes: Buffer,
  format: keyof typeof EXT,
  quality: number,
  maxWidth: number,
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  let pipeline = sharp(bytes, { animated: format === "webp" }).rotate();

  if (maxWidth > 0) {
    pipeline = pipeline.resize({
      width: maxWidth,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  switch (format) {
    case "jpeg":
      return pipeline
        .flatten({ background: "#ffffff" })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
    case "png":
      return pipeline
        .png({ compressionLevel: 9, quality, palette: quality < 100 })
        .toBuffer();
    case "webp":
      return pipeline.webp({ quality }).toBuffer();
    case "avif":
      return pipeline.avif({ quality }).toBuffer();
    case "tiff":
      return pipeline.tiff({ quality, compression: "lzw" }).toBuffer();
    default:
      throw new ConvertError("Unsupported output format.");
  }
}

export async function convertImages(
  inputs: ConvertInput[],
  options: Options,
): Promise<ConvertOutput> {
  const format = (options.format ?? "png") as keyof typeof EXT;
  if (!EXT[format]) throw new ConvertError("Unsupported output format.");
  const quality = Math.max(30, Math.min(num(options, "quality", 90), 100));

  const results = await run(inputs, format, quality, 0);
  return pack(results, inputs, EXT[format], MIME[format], `Converted to ${EXT[format].toUpperCase()}.`);
}

export async function compressImages(
  inputs: ConvertInput[],
  options: Options,
): Promise<ConvertOutput> {
  const sharp = (await import("sharp")).default;
  const quality = Math.max(20, Math.min(num(options, "quality", 72), 95));
  const maxWidth = Math.max(0, Math.min(num(options, "maxWidth", 0), 10000));

  const before = inputs.reduce((sum, i) => sum + i.bytes.length, 0);
  const results: Encoded[] = [];

  for (const input of inputs) {
    let format: keyof typeof EXT = "jpeg";
    try {
      const meta = await sharp(input.bytes).metadata();
      if (meta.format === "png") format = "png";
      else if (meta.format === "webp") format = "webp";
      else if (meta.hasAlpha) format = "png";
    } catch {
      throw new ConvertError(`"${input.name}" could not be read as an image.`);
    }

    const data = await encode(input.bytes, format, quality, maxWidth);
    const chosen = data.length < input.bytes.length ? data : input.bytes;
    results.push({ name: `${baseName(input.name)}.${EXT[format]}`, data: chosen });
  }

  const after = results.reduce((sum, r) => sum + r.data.length, 0);
  const percent = before > 0 ? Math.round(((before - after) / before) * 100) : 0;
  const note = `${formatBytes(before)} → ${formatBytes(after)} (${percent > 0 ? percent : 0}% smaller).`;

  if (results.length === 1) {
    const ext = results[0].name.split(".").pop()!;
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return {
      buffer: results[0].data,
      filename: results[0].name,
      contentType: mime,
      note,
    };
  }

  return {
    buffer: Buffer.from(
      zipSync(Object.fromEntries(results.map((r) => [r.name, new Uint8Array(r.data)])), {
        level: 0,
      }),
    ),
    filename: "compressed-images.zip",
    contentType: "application/zip",
    note,
  };
}

async function run(
  inputs: ConvertInput[],
  format: keyof typeof EXT,
  quality: number,
  maxWidth: number,
): Promise<Encoded[]> {
  const results: Encoded[] = [];
  const used = new Set<string>();

  for (const input of inputs) {
    let data: Buffer;
    try {
      data = await encode(input.bytes, format, quality, maxWidth);
    } catch {
      throw new ConvertError(
        `"${input.name}" could not be converted — it may be corrupted or an unsupported image type.`,
      );
    }
    let name = `${baseName(input.name)}.${EXT[format]}`;
    let counter = 2;
    while (used.has(name)) {
      name = `${baseName(input.name)}-${counter++}.${EXT[format]}`;
    }
    used.add(name);
    results.push({ name, data });
  }
  return results;
}

function pack(
  results: Encoded[],
  inputs: ConvertInput[],
  ext: string,
  mime: string,
  note: string,
): ConvertOutput {
  if (results.length === 0) throw new ConvertError("Select at least one image.");
  if (results.length === 1) {
    return {
      buffer: results[0].data,
      filename: results[0].name,
      contentType: mime,
      note,
    };
  }
  return {
    buffer: Buffer.from(
      zipSync(Object.fromEntries(results.map((r) => [r.name, new Uint8Array(r.data)])), {
        level: ext === "png" || ext === "tiff" ? 6 : 0,
      }),
    ),
    filename: `converted-${ext}.zip`,
    contentType: "application/zip",
    note: `${results.length} images converted to ${ext.toUpperCase()}.`,
  };
}
