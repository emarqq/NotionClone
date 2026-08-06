import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { logAndRedact } from "@/lib/llm/redact";
import { appendChunk, InvalidRecordingIdError } from "@/lib/meetings/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Append one MediaRecorder chunk to the recording's raw.webm.
 *
 * Raw octet-stream, NOT a server action and not multipart: server actions cap
 * request bodies at 1 MB, and formData parsing buys nothing for an opaque blob.
 *
 * `seq` must match exactly. Chunk 0 carries the WebM header and every later
 * chunk is a bare Cluster continuation, so an out-of-order append silently
 * produces an undecodable file. On a mismatch we return 409 with the sequence
 * the server actually wants, which makes a duplicated retry a no-op rather than
 * corruption.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const seq = Number(request.nextUrl.searchParams.get("seq"));
    if (!Number.isInteger(seq) || seq < 0) {
      return NextResponse.json({ error: "Invalid seq." }, { status: 400 });
    }

    const buf = Buffer.from(await request.arrayBuffer());
    if (buf.length === 0) {
      return NextResponse.json({ error: "Empty chunk." }, { status: 400 });
    }

    const result = await appendChunk(id, seq, buf);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason, nextSeq: result.nextSeq },
        { status: result.reason === "too-large" ? 413 : 409 }
      );
    }
    return NextResponse.json({ nextSeq: result.nextSeq });
  } catch (err) {
    if (err instanceof InvalidRecordingIdError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: logAndRedact("[meetings] chunk append failed", err) },
      { status: 500 }
    );
  }
}
