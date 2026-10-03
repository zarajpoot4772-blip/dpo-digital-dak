import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This app lives beside another Next.js app in the same repo.
  turbopack: { root: path.resolve(process.cwd()) },
  outputFileTracingRoot: path.resolve(process.cwd()),
  // Fonts and OCR/pdf.js data files are read at runtime, so keep them in the
  // traced output of the conversion route.
  outputFileTracingIncludes: {
    "/api/convert/[tool]": [
      "./assets/fonts/**",
      "./node_modules/pdfjs-dist/standard_fonts/**",
      "./node_modules/pdfjs-dist/cmaps/**",
      "./node_modules/pdfjs-dist/wasm/**",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/@tesseract.js-data/**",
      "./node_modules/tesseract.js-core/**",
    ],
  },
  // Heavy native / node-only packages must stay outside the bundler.
  serverExternalPackages: [
    "sharp",
    "@napi-rs/canvas",
    "pdfjs-dist",
    "tesseract.js",
    "exceljs",
    "mammoth",
    "docx",
    "pdf-lib",
  ],
  // Arena / e2b live preview proxies requests from https://{port}-{sandbox}.e2b.app
  allowedDevOrigins: ["*.e2b.app", "*.app.github.dev", "localhost"],
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
