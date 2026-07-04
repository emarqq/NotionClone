/**
 * Dispatches file text extraction by MIME type (with an extension fallback,
 * since browsers sometimes send generic types like application/octet-stream
 * for docx/xlsx uploads). Returns null for unsupported formats (e.g. pptx,
 * images) — callers mark those `extraction_status = 'unsupported'`.
 */

import type { Segment } from "@/lib/rag/chunker";
import { extractPdf } from "@/lib/rag/extractors/pdf";
import { extractDocx } from "@/lib/rag/extractors/docx";
import { extractXlsx } from "@/lib/rag/extractors/xlsx";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export async function extractFile(
  data: Uint8Array,
  mimeType: string,
  filename: string
): Promise<Segment[] | null> {
  const mime = mimeType.toLowerCase();
  const ext = extOf(filename);

  if (mime === "application/pdf" || ext === "pdf") {
    return extractPdf(data);
  }
  if (mime === DOCX_MIME || ext === "docx") {
    return extractDocx(data);
  }
  if (mime === XLSX_MIME || ext === "xlsx") {
    return extractXlsx(data);
  }
  if (mime === "text/plain" || mime === "text/markdown" || ext === "txt" || ext === "md") {
    const text = new TextDecoder("utf-8").decode(data).trim();
    return text ? [{ headingPath: [], text }] : [];
  }

  // Unsupported: pptx, images, and anything else without a free JS extractor.
  return null;
}
