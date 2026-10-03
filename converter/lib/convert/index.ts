import { ConvertError, ConvertInput, ConvertOutput, Options } from "./types";
import {
  ocrToText,
  pdfToExcel,
  pdfToImages,
  pdfToText,
  pdfToWord,
} from "./from-pdf";
import { excelToPdf, imageToPdf, textToPdf, wordToPdf } from "./to-pdf";
import { compressPdf, mergePdf, rotatePdf, splitPdf } from "./organise";
import { compressImages, convertImages } from "./images";

type Handler = (inputs: ConvertInput[], options: Options) => Promise<ConvertOutput>;

const first = (fn: (input: ConvertInput, options: Options) => Promise<ConvertOutput>): Handler =>
  async (inputs, options) => {
    if (inputs.length === 0) throw new ConvertError("Please choose a file first.");
    return fn(inputs[0], options);
  };

export const HANDLERS: Record<string, Handler> = {
  "pdf-to-word": first(pdfToWord),
  "pdf-to-excel": first(pdfToExcel),
  "pdf-to-text": first(pdfToText),
  "pdf-to-jpg": first((input, options) => pdfToImages(input, options, "jpeg")),
  "pdf-to-png": first((input, options) => pdfToImages(input, options, "png")),
  "ocr-pdf": first(ocrToText),
  "word-to-pdf": first(wordToPdf),
  "excel-to-pdf": first(excelToPdf),
  "text-to-pdf": first(textToPdf),
  "image-to-pdf": imageToPdf,
  "merge-pdf": mergePdf,
  "split-pdf": first(splitPdf),
  "rotate-pdf": first(rotatePdf),
  "compress-pdf": first(compressPdf),
  "image-convert": convertImages,
  "compress-image": compressImages,
};

export async function runConversion(
  slug: string,
  inputs: ConvertInput[],
  options: Options,
): Promise<ConvertOutput> {
  const handler = HANDLERS[slug];
  if (!handler) throw new ConvertError(`Unknown tool "${slug}".`, 404);
  return handler(inputs, options);
}
