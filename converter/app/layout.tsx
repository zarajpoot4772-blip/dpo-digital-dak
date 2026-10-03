import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "File Converter Hub — PDF to Word, Excel, JPG and more",
    template: "%s — File Converter Hub",
  },
  description:
    "Free online file converter: PDF to Word, PDF to Excel, PDF to JPG, Word to PDF, Excel to PDF, image to PDF, merge, split, compress and rotate PDFs, plus OCR for scanned documents.",
  keywords: [
    "pdf to word",
    "pdf to excel",
    "word to pdf",
    "merge pdf",
    "compress pdf",
    "image to pdf",
    "ocr",
    "file converter",
  ],
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2f6bff",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="shell inner">
            <Link href="/" className="logo">
              <span className="mark">FC</span>
              <span>File Converter Hub</span>
            </Link>
            <nav className="nav">
              <Link href="/tool/pdf-to-word">PDF to Word</Link>
              <Link href="/tool/pdf-to-excel">PDF to Excel</Link>
              <Link href="/tool/merge-pdf">Merge PDF</Link>
              <Link href="/tool/compress-pdf">Compress</Link>
              <Link href="/#all-tools">All tools</Link>
            </nav>
          </div>
        </header>

        <main>{children}</main>

        <footer className="site-footer">
          <div className="shell">
            <div className="cols">
              <div>
                <h4>Convert from PDF</h4>
                <ul>
                  <li>
                    <Link href="/tool/pdf-to-word">PDF to Word</Link>
                  </li>
                  <li>
                    <Link href="/tool/pdf-to-excel">PDF to Excel</Link>
                  </li>
                  <li>
                    <Link href="/tool/pdf-to-jpg">PDF to JPG</Link>
                  </li>
                  <li>
                    <Link href="/tool/pdf-to-text">PDF to Text</Link>
                  </li>
                </ul>
              </div>
              <div>
                <h4>Convert to PDF</h4>
                <ul>
                  <li>
                    <Link href="/tool/word-to-pdf">Word to PDF</Link>
                  </li>
                  <li>
                    <Link href="/tool/excel-to-pdf">Excel to PDF</Link>
                  </li>
                  <li>
                    <Link href="/tool/image-to-pdf">Image to PDF</Link>
                  </li>
                  <li>
                    <Link href="/tool/text-to-pdf">Text to PDF</Link>
                  </li>
                </ul>
              </div>
              <div>
                <h4>Organise</h4>
                <ul>
                  <li>
                    <Link href="/tool/merge-pdf">Merge PDF</Link>
                  </li>
                  <li>
                    <Link href="/tool/split-pdf">Split PDF</Link>
                  </li>
                  <li>
                    <Link href="/tool/compress-pdf">Compress PDF</Link>
                  </li>
                  <li>
                    <Link href="/tool/rotate-pdf">Rotate PDF</Link>
                  </li>
                </ul>
              </div>
              <div>
                <h4>Images &amp; OCR</h4>
                <ul>
                  <li>
                    <Link href="/tool/image-convert">Image Converter</Link>
                  </li>
                  <li>
                    <Link href="/tool/compress-image">Compress Image</Link>
                  </li>
                  <li>
                    <Link href="/tool/ocr-pdf">OCR scanned files</Link>
                  </li>
                </ul>
              </div>
            </div>
            <div>
              Files are processed on the server in memory and are never stored —
              nothing is written to disk and nothing is shared with a third party.
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
