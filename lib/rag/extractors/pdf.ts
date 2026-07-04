/** PDF text extraction via unpdf (pdf.js compiled for serverless runtimes). */

import { extractText, getDocumentProxy } from "unpdf";
import type { Segment } from "@/lib/rag/chunker";

/** One segment per page, headingPath `['Page N']`. */
export async function extractPdf(data: Uint8Array): Promise<Segment[]> {
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  const segments: Segment[] = [];
  text.forEach((pageText, index) => {
    const trimmed = pageText.trim();
    if (!trimmed) return;
    segments.push({ headingPath: [`Page ${index + 1}`], text: trimmed });
  });
  return segments;
}
