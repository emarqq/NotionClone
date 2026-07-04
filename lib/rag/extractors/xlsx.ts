/** XLSX text extraction via SheetJS (xlsx): one segment per sheet, rows as tab-separated lines. */

import * as XLSX from "xlsx";
import type { Segment } from "@/lib/rag/chunker";

export async function extractXlsx(data: Uint8Array): Promise<Segment[]> {
  const workbook = XLSX.read(data, { type: "array" });
  const segments: Segment[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
    });
    const text = rows
      .map((row) => row.map((cell) => String(cell ?? "").trim()).join("\t"))
      .filter((line) => line.replace(/\t/g, "").length > 0)
      .join("\n");
    if (!text) continue;
    segments.push({ headingPath: [sheetName], text });
  }

  return segments;
}
