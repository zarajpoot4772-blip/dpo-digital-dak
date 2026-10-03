import { NextRequest, NextResponse } from "next/server";
import { MAX_FILE_BYTES, getTool } from "@/lib/tools";
import { runConversion } from "@/lib/convert";
import { ConvertError, type ConvertInput } from "@/lib/convert/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ tool: string }> },
) {
  const { tool: slug } = await context.params;
  const tool = getTool(slug);
  if (!tool) return fail("That conversion tool does not exist.", 404);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("The upload could not be read. Please try again.", 400);
  }

  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (files.length === 0) return fail("Please choose at least one file.");
  if (!tool.multiple && files.length > 1) {
    return fail("This tool accepts a single file at a time.");
  }
  if (files.length > tool.maxFiles) {
    return fail(`This tool accepts at most ${tool.maxFiles} files at once.`);
  }

  const inputs: ConvertInput[] = [];
  for (const file of files) {
    if (file.size === 0) return fail(`"${file.name}" is empty.`);
    if (file.size > MAX_FILE_BYTES) {
      return fail(
        `"${file.name}" is larger than ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`,
      );
    }
    const ext = extensionOf(file.name);
    if (ext && !tool.extensions.includes(ext)) {
      return fail(
        `"${file.name}" is a .${ext} file. ${tool.title} accepts: ${tool.extensions
          .map((e) => `.${e}`)
          .join(", ")}.`,
      );
    }
    inputs.push({
      name: file.name || "file",
      bytes: Buffer.from(await file.arrayBuffer()),
      type: file.type || "application/octet-stream",
    });
  }

  const options: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (key !== "files" && typeof value === "string") options[key] = value;
  }

  try {
    const started = Date.now();
    const result = await runConversion(slug, inputs, options);
    const elapsed = Date.now() - started;

    // Everything is produced in memory — no uploaded bytes are written to disk.
    const body = new Uint8Array(result.buffer);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Length": String(body.byteLength),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(result.filename).replace(/'/g, "%27")}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        "X-Converted-Filename": encodeURIComponent(result.filename),
        "X-Convert-Note": encodeURIComponent(result.note ?? ""),
        "X-Convert-Ms": String(elapsed),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ConvertError) return fail(error.message, error.status);
    console.error(`[convert:${slug}]`, error);
    const message =
      error instanceof Error && error.message
        ? error.message
        : "The conversion failed unexpectedly.";
    return fail(`Conversion failed: ${message}`, 500);
  }
}
