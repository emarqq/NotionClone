import { NextResponse } from "next/server";

import { getBlocks } from "@/lib/db/blocks";
import { getPage } from "@/lib/db/pages";
import { serializeBlocksToDocx } from "@/lib/export/serializeDocx";
import { renderPageToHtmlDocument } from "@/lib/export/serializeHtml";
import { serializeBlocksToMarkdown } from "@/lib/export/serialize";

// docx/Buffer generation needs the Node runtime — never edge.
export const runtime = "nodejs";

type Format = "markdown" | "docx" | "pdf";

function sanitizeFilename(title: string): string {
  const base = title.trim().replace(/[/\\:*?"<>|]/g, "-").replace(/\s+/g, " ");
  return base || "Untitled";
}

/**
 * On-demand page export for the "Export" toolbar button — distinct from
 * `/api/export`, which is the background Obsidian-vault mirror. `?format=`
 * one of `markdown` (downloads a .md file), `docx` (downloads a .docx file),
 * or `pdf` (returns a print-ready HTML page that auto-opens the browser's
 * print dialog, so the user saves it as a PDF themselves).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const { pageId } = await params;
  const format = (new URL(request.url).searchParams.get("format") ?? "markdown") as Format;

  const page = await getPage(pageId);
  if (!page) {
    return NextResponse.json({ error: `Page ${pageId} not found.` }, { status: 404 });
  }
  const blocks = await getBlocks(pageId);
  const title = page.title || "Untitled";
  const filename = sanitizeFilename(title);

  if (format === "markdown") {
    const body = serializeBlocksToMarkdown(blocks, { resolveWikilink: () => null });
    const content = `# ${title}\n\n${body}\n`;
    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.md"`,
      },
    });
  }

  if (format === "docx") {
    const buffer = await serializeBlocksToDocx(title, blocks);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}.docx"`,
      },
    });
  }

  if (format === "pdf") {
    const html = renderPageToHtmlDocument(title, blocks);
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return NextResponse.json({ error: `Unknown format "${format}".` }, { status: 400 });
}
