export type ConvertOutput = {
  /** Raw bytes of the produced file. */
  buffer: Buffer;
  /** Suggested download filename, including extension. */
  filename: string;
  contentType: string;
  /** Short human readable note shown in the UI, e.g. "12 pages converted". */
  note?: string;
};

export type ConvertInput = {
  name: string;
  bytes: Buffer;
  type: string;
};

export type Options = Record<string, string>;

export class ConvertError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ConvertError";
    this.status = status;
  }
}

export function baseName(filename: string): string {
  const withoutPath = filename.split(/[\\/]/).pop() ?? filename;
  const dot = withoutPath.lastIndexOf(".");
  const stem = dot > 0 ? withoutPath.slice(0, dot) : withoutPath;
  return stem.replace(/[^\p{L}\p{N}\-_. ]/gu, "").trim() || "converted";
}

export function num(options: Options, key: string, fallback: number): number {
  const value = Number(options[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function bool(options: Options, key: string, fallback: boolean): boolean {
  const value = options[key];
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1" || value === "on";
}

/** Parse "1-3, 7, 10-12" into zero-based page indexes. */
export function parseRange(spec: string, pageCount: number): number[] {
  const trimmed = (spec ?? "").trim();
  if (!trimmed) return Array.from({ length: pageCount }, (_, i) => i);

  const pages = new Set<number>();
  for (const part of trimmed.split(",")) {
    const chunk = part.trim();
    if (!chunk) continue;
    const match = /^(\d+)\s*(?:[-–]\s*(\d+))?$/.exec(chunk);
    if (!match) throw new ConvertError(`Could not understand the page range "${chunk}".`);
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (start < 1 || end < start) {
      throw new ConvertError(`Invalid page range "${chunk}".`);
    }
    for (let p = start; p <= Math.min(end, pageCount); p++) pages.add(p - 1);
  }

  const list = [...pages].sort((a, b) => a - b);
  if (list.length === 0) {
    throw new ConvertError("The selected page range is outside this document.");
  }
  return list;
}

export function zipName(stem: string): string {
  return `${stem}.zip`;
}
