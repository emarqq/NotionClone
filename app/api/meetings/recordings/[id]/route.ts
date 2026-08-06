import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { logAndRedact } from "@/lib/llm/redact";
import { transcriptHeader } from "@/lib/meetings/header";
import { InvalidRecordingIdError, readMeta, readTurns } from "@/lib/meetings/store";
import type { RecordingDetail } from "@/lib/meetings/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recording status (+ turns once ready). Polled every 2s while processing. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const meta = await readMeta(id);
    const turns = meta.status === "ready" ? await readTurns(id) : null;

    const detail: RecordingDetail & { header: string } = {
      ...meta,
      turns,
      header: transcriptHeader(meta),
    };
    return NextResponse.json(detail);
  } catch (err) {
    if (err instanceof InvalidRecordingIdError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "No such recording." }, { status: 404 });
    }
    return NextResponse.json(
      { error: logAndRedact("[meetings] read failed", err) },
      { status: 500 }
    );
  }
}
