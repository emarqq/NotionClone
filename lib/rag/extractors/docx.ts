/** DOCX text extraction via mammoth (raw text, formatting discarded). */

import mammoth from "mammoth";
import type { Segment } from "@/lib/rag/chunker";

/** One segment per paragraph (mammoth separates paragraphs with newlines). */
export async function extractDocx(data: Uint8Array): Promise<Segment[]> {
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data) });
  return value
    .split(/\r?\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((text) => ({ headingPath: [], text }));
}
