// Shared tool registry. Safe to import from both client and server components.

export type FieldType = "select" | "number" | "text" | "checkbox";

export type ToolField = {
  name: string;
  label: string;
  type: FieldType;
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  placeholder?: string;
  help?: string;
};

export type ToolCategory =
  | "Convert from PDF"
  | "Convert to PDF"
  | "Organise PDF"
  | "Images";

export type Tool = {
  slug: string;
  title: string;
  short: string;
  description: string;
  category: ToolCategory;
  icon: string;
  accent: string;
  /** Comma separated accept attribute for <input type=file> */
  accept: string;
  extensions: string[];
  multiple: boolean;
  maxFiles: number;
  outputHint: string;
  fields?: ToolField[];
};

export const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB per file

export const TOOLS: Tool[] = [
  // ---------------------------------------------------------------- from PDF
  {
    slug: "pdf-to-word",
    title: "PDF to Word",
    short: "PDF → DOCX",
    description:
      "Convert a PDF into an editable Microsoft Word (.docx) document. Text, paragraph flow, headings and basic alignment are preserved.",
    category: "Convert from PDF",
    icon: "W",
    accent: "#2b5fd9",
    accept: "application/pdf,.pdf",
    extensions: ["pdf"],
    multiple: false,
    maxFiles: 1,
    outputHint: ".docx",
    fields: [
      {
        name: "pageBreaks",
        label: "Keep a page break between PDF pages",
        type: "checkbox",
        default: true,
      },
    ],
  },
  {
    slug: "pdf-to-excel",
    title: "PDF to Excel",
    short: "PDF → XLSX",
    description:
      "Pull tables and columnar data out of a PDF into an Excel workbook (.xlsx). Each PDF page becomes its own worksheet.",
    category: "Convert from PDF",
    icon: "X",
    accent: "#1d8a4e",
    accept: "application/pdf,.pdf",
    extensions: ["pdf"],
    multiple: false,
    maxFiles: 1,
    outputHint: ".xlsx",
    fields: [
      {
        name: "sheetMode",
        label: "Worksheet layout",
        type: "select",
        default: "per-page",
        options: [
          { value: "per-page", label: "One sheet per PDF page" },
          { value: "single", label: "All pages in one sheet" },
        ],
      },
    ],
  },
  {
    slug: "pdf-to-jpg",
    title: "PDF to JPG",
    short: "PDF → JPG",
    description:
      "Render every page of a PDF as a high quality JPG image. Multiple pages are delivered as a ZIP archive.",
    category: "Convert from PDF",
    icon: "IMG",
    accent: "#d97706",
    accept: "application/pdf,.pdf",
    extensions: ["pdf"],
    multiple: false,
    maxFiles: 1,
    outputHint: ".jpg / .zip",
    fields: [
      {
        name: "dpi",
        label: "Resolution (DPI)",
        type: "select",
        default: "150",
        options: [
          { value: "96", label: "96 — screen" },
          { value: "150", label: "150 — balanced" },
          { value: "220", label: "220 — high" },
          { value: "300", label: "300 — print" },
        ],
      },
      {
        name: "quality",
        label: "JPG quality",
        type: "number",
        default: 90,
        min: 40,
        max: 100,
      },
    ],
  },
  {
    slug: "pdf-to-png",
    title: "PDF to PNG",
    short: "PDF → PNG",
    description:
      "Render PDF pages as lossless PNG images with transparency support. Multiple pages are delivered as a ZIP archive.",
    category: "Convert from PDF",
    icon: "PNG",
    accent: "#7c3aed",
    accept: "application/pdf,.pdf",
    extensions: ["pdf"],
    multiple: false,
    maxFiles: 1,
    outputHint: ".png / .zip",
    fields: [
      {
        name: "dpi",
        label: "Resolution (DPI)",
        type: "select",
        default: "150",
        options: [
          { value: "96", label: "96 — screen" },
          { value: "150", label: "150 — balanced" },
          { value: "220", label: "220 — high" },
          { value: "300", label: "300 — print" },
        ],
      },
    ],
  },
  {
    slug: "pdf-to-text",
    title: "PDF to Text",
    short: "PDF → TXT",
    description:
      "Extract all readable text from a PDF into a plain .txt file — ideal for copying, indexing or search.",
    category: "Convert from PDF",
    icon: "TXT",
    accent: "#475569",
    accept: "application/pdf,.pdf",
    extensions: ["pdf"],
    multiple: false,
    maxFiles: 1,
    outputHint: ".txt",
  },
  {
    slug: "ocr-pdf",
    title: "OCR — Scanned PDF / Image to Text",
    short: "Scan → TXT",
    description:
      "Read text out of scanned documents and photos using on-server OCR. Supports English and Urdu. Nothing is sent to a third-party cloud.",
    category: "Convert from PDF",
    icon: "OCR",
    accent: "#be123c",
    accept: "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff",
    extensions: ["pdf", "jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff"],
    multiple: false,
    maxFiles: 1,
    outputHint: ".txt",
    fields: [
      {
        name: "lang",
        label: "Document language",
        type: "select",
        default: "eng",
        options: [
          { value: "eng", label: "English" },
          { value: "urd", label: "Urdu / اردو" },
          { value: "eng+urd", label: "English + Urdu" },
        ],
      },
      {
        name: "maxPages",
        label: "Maximum pages to scan",
        type: "number",
        default: 5,
        min: 1,
        max: 20,
        help: "OCR is slow — keep this low for large documents.",
      },
    ],
  },

  // ------------------------------------------------------------------ to PDF
  {
    slug: "word-to-pdf",
    title: "Word to PDF",
    short: "DOCX → PDF",
    description:
      "Turn a Microsoft Word document into a clean, shareable PDF. Headings, bold/italic text, lists and tables are carried over. Urdu and Arabic script supported.",
    category: "Convert to PDF",
    icon: "W",
    accent: "#2b5fd9",
    accept:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx",
    extensions: ["docx"],
    multiple: false,
    maxFiles: 1,
    outputHint: ".pdf",
    fields: [
      {
        name: "pageSize",
        label: "Page size",
        type: "select",
        default: "A4",
        options: [
          { value: "A4", label: "A4" },
          { value: "Letter", label: "US Letter" },
          { value: "Legal", label: "Legal" },
        ],
      },
    ],
  },
  {
    slug: "excel-to-pdf",
    title: "Excel to PDF",
    short: "XLSX → PDF",
    description:
      "Convert an Excel workbook or CSV into a tidy, printable PDF table. Each worksheet starts on a new page.",
    category: "Convert to PDF",
    icon: "X",
    accent: "#1d8a4e",
    accept:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,.xlsx,.csv",
    extensions: ["xlsx", "csv"],
    multiple: false,
    maxFiles: 1,
    outputHint: ".pdf",
    fields: [
      {
        name: "orientation",
        label: "Orientation",
        type: "select",
        default: "landscape",
        options: [
          { value: "landscape", label: "Landscape" },
          { value: "portrait", label: "Portrait" },
        ],
      },
    ],
  },
  {
    slug: "image-to-pdf",
    title: "Image to PDF",
    short: "JPG/PNG → PDF",
    description:
      "Combine JPG, PNG, WEBP, HEIC or TIFF images into a single PDF — in the order you choose.",
    category: "Convert to PDF",
    icon: "IMG",
    accent: "#d97706",
    accept: "image/*,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.gif,.avif",
    extensions: ["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff", "gif", "avif"],
    multiple: true,
    maxFiles: 50,
    outputHint: ".pdf",
    fields: [
      {
        name: "fit",
        label: "Page layout",
        type: "select",
        default: "fit",
        options: [
          { value: "fit", label: "Fit image inside A4 page" },
          { value: "exact", label: "Page matches image size" },
        ],
      },
      {
        name: "margin",
        label: "Margin (points)",
        type: "number",
        default: 20,
        min: 0,
        max: 120,
      },
    ],
  },
  {
    slug: "text-to-pdf",
    title: "Text to PDF",
    short: "TXT → PDF",
    description:
      "Convert a plain text, Markdown, CSV or log file into a neatly typeset PDF document.",
    category: "Convert to PDF",
    icon: "TXT",
    accent: "#475569",
    accept: "text/plain,.txt,.md,.log,.csv",
    extensions: ["txt", "md", "log", "csv"],
    multiple: false,
    maxFiles: 1,
    outputHint: ".pdf",
    fields: [
      {
        name: "fontSize",
        label: "Font size (pt)",
        type: "number",
        default: 11,
        min: 7,
        max: 24,
      },
    ],
  },

  // ------------------------------------------------------------- organise
  {
    slug: "merge-pdf",
    title: "Merge PDF",
    short: "Many → one PDF",
    description:
      "Join several PDF files into one document, in exactly the order you arrange them.",
    category: "Organise PDF",
    icon: "M",
    accent: "#0891b2",
    accept: "application/pdf,.pdf",
    extensions: ["pdf"],
    multiple: true,
    maxFiles: 30,
    outputHint: ".pdf",
  },
  {
    slug: "split-pdf",
    title: "Split PDF",
    short: "Extract pages",
    description:
      "Pull out a page range from a PDF, or explode every page into its own file as a ZIP.",
    category: "Organise PDF",
    icon: "S",
    accent: "#0891b2",
    accept: "application/pdf,.pdf",
    extensions: ["pdf"],
    multiple: false,
    maxFiles: 1,
    outputHint: ".pdf / .zip",
    fields: [
      {
        name: "mode",
        label: "Split mode",
        type: "select",
        default: "range",
        options: [
          { value: "range", label: "Extract a page range into one PDF" },
          { value: "each", label: "Every page as a separate PDF (ZIP)" },
        ],
      },
      {
        name: "range",
        label: "Pages",
        type: "text",
        default: "1-1",
        placeholder: "e.g. 1-3, 7, 10-12",
        help: "Used only in range mode. Leave blank for all pages.",
      },
    ],
  },
  {
    slug: "compress-pdf",
    title: "Compress PDF",
    short: "Shrink file size",
    description:
      "Reduce PDF file size by re-encoding embedded images and stripping redundant data, while keeping it readable.",
    category: "Organise PDF",
    icon: "↓",
    accent: "#059669",
    accept: "application/pdf,.pdf",
    extensions: ["pdf"],
    multiple: false,
    maxFiles: 1,
    outputHint: ".pdf",
    fields: [
      {
        name: "level",
        label: "Compression level",
        type: "select",
        default: "medium",
        options: [
          { value: "light", label: "Light — best quality" },
          { value: "medium", label: "Medium — recommended" },
          { value: "strong", label: "Strong — smallest file" },
        ],
      },
    ],
  },
  {
    slug: "rotate-pdf",
    title: "Rotate PDF",
    short: "Fix orientation",
    description:
      "Rotate all pages — or just selected pages — of a PDF by 90, 180 or 270 degrees.",
    category: "Organise PDF",
    icon: "↻",
    accent: "#0891b2",
    accept: "application/pdf,.pdf",
    extensions: ["pdf"],
    multiple: false,
    maxFiles: 1,
    outputHint: ".pdf",
    fields: [
      {
        name: "angle",
        label: "Rotation",
        type: "select",
        default: "90",
        options: [
          { value: "90", label: "90° clockwise" },
          { value: "180", label: "180°" },
          { value: "270", label: "90° anti-clockwise" },
        ],
      },
      {
        name: "range",
        label: "Pages",
        type: "text",
        default: "",
        placeholder: "blank = all pages, e.g. 2-4, 8",
      },
    ],
  },

  // -------------------------------------------------------------- images
  {
    slug: "image-convert",
    title: "Image Converter",
    short: "JPG ↔ PNG ↔ WEBP",
    description:
      "Convert images between JPG, PNG, WEBP, AVIF and TIFF. Batch convert many files at once — you get a ZIP back.",
    category: "Images",
    icon: "⇄",
    accent: "#db2777",
    accept: "image/*,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.gif,.avif",
    extensions: ["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff", "gif", "avif"],
    multiple: true,
    maxFiles: 50,
    outputHint: "image / .zip",
    fields: [
      {
        name: "format",
        label: "Convert to",
        type: "select",
        default: "png",
        options: [
          { value: "jpeg", label: "JPG" },
          { value: "png", label: "PNG" },
          { value: "webp", label: "WEBP" },
          { value: "avif", label: "AVIF" },
          { value: "tiff", label: "TIFF" },
        ],
      },
      {
        name: "quality",
        label: "Quality",
        type: "number",
        default: 90,
        min: 30,
        max: 100,
      },
    ],
  },
  {
    slug: "compress-image",
    title: "Compress Image",
    short: "Smaller images",
    description:
      "Shrink JPG, PNG and WEBP files for faster websites and email — with an optional maximum width.",
    category: "Images",
    icon: "↓",
    accent: "#db2777",
    accept: "image/*,.jpg,.jpeg,.png,.webp,.tif,.tiff",
    extensions: ["jpg", "jpeg", "png", "webp", "tif", "tiff"],
    multiple: true,
    maxFiles: 50,
    outputHint: "image / .zip",
    fields: [
      {
        name: "quality",
        label: "Quality",
        type: "number",
        default: 72,
        min: 20,
        max: 95,
      },
      {
        name: "maxWidth",
        label: "Max width in pixels (0 = keep original)",
        type: "number",
        default: 0,
        min: 0,
        max: 10000,
      },
    ],
  },
];

export const CATEGORIES: ToolCategory[] = [
  "Convert from PDF",
  "Convert to PDF",
  "Organise PDF",
  "Images",
];

export function getTool(slug: string): Tool | undefined {
  return TOOLS.find((t) => t.slug === slug);
}
