import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { logAndRedact } from "@/lib/llm/redact";
import { processRecording } from "@/lib/meetings/pipeline";
import { InvalidRecordingIdError, patchMeta, readMeta } from "@/lib/meetings/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Close a recording and start processing.
 *
 * Returns 202 immediately and lets the pipeline run detached — transcription
 * takes minutes and must not hold a request open. Progress is published to
 * meta.json, which the client polls.
 *
 * Idempotent by design: this is also the "Retry transcription" endpoint, since
 * the audio is still on disk after a failure.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const meta = await readMeta(id);

    if (meta.status === "ready" || meta.insertedAt) {
      return NextResponse.json({ status: meta.status }, { status: 200 });
    }

    let durationMs = meta.durationMs;
    try {
      const body = await request.json();
      if (typeof body?.durationMs === "number") durationMs = body.durationMs;
    } catch {
      // No body is fine — the pipeline measures the audio itself.
    }

    await patchMeta(id, { status: "uploaded", durationMs, error: null });

    // Intentionally not awaited, and intentionally not `after()`: `after()` is
    // tied to this request's lifecycle, which is wrong for a multi-minute job.
    void processRecording(id);

    return NextResponse.json({ status: "uploaded" }, { status: 202 });
  } catch (err) {
    if (err instanceof InvalidRecordingIdError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: logAndRedact("[meetings] finish failed", err) },
      { status: 500 }
    );
  }
}
