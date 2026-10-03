# File Converter Hub

A standalone online file-conversion website — PDF to Word, PDF to Excel, Word/Excel/images to
PDF, merge / split / compress / rotate PDFs, batch image conversion and offline OCR.

It lives in the `converter/` folder of this repository and is **completely independent** of the
DPO Digital Dak application in the repository root: its own `package.json`, its own
`node_modules`, its own port. Nothing in the Dak system was changed.

## Run it

```bash
cd converter
npm install
npm run dev        # http://localhost:3100
```

```bash
npm run build && npm start   # production
npm run typecheck            # TypeScript
npm run test:smoke           # live API test of every tool (dev server must be running)
```

## Tools (17)

| Category | Tool | In → out |
|---|---|---|
| Convert from PDF | PDF to Word | `.pdf` → `.docx` |
| | PDF to Excel | `.pdf` → `.xlsx` |
| | PDF to JPG | `.pdf` → `.jpg` / `.zip` |
| | PDF to PNG | `.pdf` → `.png` / `.zip` |
| | PDF to Text | `.pdf` → `.txt` |
| | OCR (scan → text) | `.pdf`, images → `.txt` |
| Convert to PDF | Word to PDF | `.docx` → `.pdf` |
| | Excel to PDF | `.xlsx`, `.csv` → `.pdf` |
| | Image to PDF | images → `.pdf` |
| | Text to PDF | `.txt`, `.md`, `.log`, `.csv` → `.pdf` |
| Organise PDF | Merge PDF | many `.pdf` → one `.pdf` |
| | Split PDF | `.pdf` → `.pdf` / `.zip` |
| | Compress PDF | `.pdf` → smaller `.pdf` |
| | Rotate PDF | `.pdf` → `.pdf` |
| Images | Image Converter | JPG ↔ PNG ↔ WEBP ↔ AVIF ↔ TIFF |
| | Compress Image | smaller JPG/PNG/WEBP |

Limits: 100 MB per file; up to 50 files for batch tools, 30 for merge.

## How it works

Conversion runs **server-side in Node.js**, entirely in memory. The uploaded bytes are read from
the multipart request, converted, streamed back as the response and then dropped — nothing is
written to disk, no database, no third-party API, no telemetry.

| Concern | Implementation |
|---|---|
| PDF parsing & rendering | `pdfjs-dist` (in-process worker) + `@napi-rs/canvas` |
| PDF creation & editing | `pdf-lib` + `@pdf-lib/fontkit` |
| Word read / write | `mammoth` (read) and `docx` (write) |
| Spreadsheets | `exceljs` |
| Images | `sharp` |
| OCR | `tesseract.js` with locally installed `@tesseract.js-data` models |
| Archives | `fflate` |

No LibreOffice, Microsoft Office or headless Chrome is required, so it deploys to any plain
Node.js host.

### Notable implementation details

* **Layout-aware PDF text extraction** (`lib/convert/pdfjs.ts`) — glyph runs are clustered into
  visual lines and then into columns using the horizontal gaps pdf.js reports, which is what lets
  *PDF to Excel* recover table cells and *PDF to Word* recreate headings, bold runs and
  paragraphs instead of a wall of text.
* **Urdu / Arabic support** (`lib/convert/pdf-writer.ts`) — pdf-lib draws glyphs in visual order
  and performs no shaping, so RTL text is shaped with `arabic-persian-reshaper` and reordered
  with `bidi-js` before drawing. The Naskh face is embedded **unsubsetted**, because pdf-lib's
  subsetter drops the Arabic presentation-form glyphs the shaper produces. It is only embedded
  when the source document actually contains RTL text.
* **PDF compression** re-encodes embedded `DCTDecode` and 8-bit `FlateDecode` images through
  sharp and rewrites the file with object streams. Masked images and unusual colour spaces are
  skipped, and if the result is not smaller the original file is returned untouched.
* **Offline OCR** (`lib/convert/ocr-engine.ts`) — `tesseract.js` would otherwise fetch its
  language models from a CDN. The `.traineddata.gz` files from the installed
  `@tesseract.js-data/*` packages are staged into a temp directory and passed via `langPath`, so
  documents never leave the server. Jobs are serialised and time-limited.
* **Turbopack caveat** — under Turbopack `import.meta.url` becomes a virtual `[project]/…` URL
  and literal `require.resolve("pkg/file")` calls get rewritten, which breaks pdf.js's runtime
  worker import. Package directories are therefore located by walking up from `process.cwd()`.

## Layout

```
converter/
├── app/
│   ├── page.tsx                      home page / tool directory
│   ├── tool/[slug]/page.tsx          one page per tool
│   └── api/convert/[tool]/route.ts   single upload + convert endpoint
├── components/ConverterPanel.tsx     drag & drop UI, options, download
├── lib/
│   ├── tools.ts                      tool registry (shared client/server)
│   └── convert/                      one module per conversion family
├── assets/fonts/                     DejaVu Sans + Noto Naskh Arabic
└── scripts/smoke-test.mjs            end-to-end API test
```

Adding a tool = one entry in `lib/tools.ts` + one handler registered in `lib/convert/index.ts`.
The home page, tool page, upload UI and option form are all generated from the registry.
