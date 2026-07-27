import { NextResponse } from "next/server";

import { exportPage, reconcileAll } from "@/lib/export/exportPage";

// fs/os require the Node runtime — never edge (mirrors the ingest route default).
export const runtime = "nodejs";

interface ExportRequestBody {
  pageId?: string;
  all?: boolean;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Markdown-mirror backfill/reconcile endpoint (parallels /api/ingest). POST
 * `{pageId}` to re-mirror one page, or `{all: true}` to mirror every page,
 * fix drift (renames/moves/archives), and delete orphaned files whose page no
 * longer exists. Exactly one of pageId or all must be set.
 */
export async function POST(request: Request) {
  let body: ExportRequestBody;
  try {
    body = await request.json();
  } catch {
    return jsonError("Expected a JSON body.", 400);
  }

  const targets = [body.pageId, body.all].filter((v) => v !== undefined && v !== null && v !== false);
  if (targets.length !== 1) {
    return jsonError("Exactly one of pageId or all must be set.", 400);
  }

  try {
    if (body.pageId) {
      await exportPage(body.pageId);
      return NextResponse.json({ ok: true, pageId: body.pageId });
    }
    const summary = await reconcileAll();
    return NextResponse.json(summary);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}
