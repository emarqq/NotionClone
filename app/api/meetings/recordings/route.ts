import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { logAndRedact } from "@/lib/llm/redact";
import { createRecording, listPending } from "@/lib/meetings/store";
import type { SourceInfo } from "@/lib/meetings/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function coerceSource(value: unknown): SourceInfo {
  const v = (value ?? {}) as Partial<SourceInfo>;
  const kind = v.kind === "device" || v.kind === "display" ? v.kind : "none";
  return {
    kind,
    deviceId: typeof v.deviceId === "string" ? v.deviceId : undefined,
    label: typeof v.label === "string" && v.label ? v.label.slice(0, 200) : "None",
  };
}

/** Create a recording: allocates the directory and meta.json, returns its id. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pageId, spaceSlug, pageTitle, startedAtMs, sources } = body ?? {};

    if (typeof pageId !== "string" || !pageId) {
      return NextResponse.json({ error: "pageId is required." }, { status: 400 });
    }

    const meta = await createRecording({
      pageId,
      spaceSlug: typeof spaceSlug === "string" ? spaceSlug : "",
      pageTitle: typeof pageTitle === "string" ? pageTitle : "Untitled",
      startedAtMs: typeof startedAtMs === "number" ? startedAtMs : Date.now(),
      sources: {
        mic: coerceSource(sources?.mic),
        system: coerceSource(sources?.system),
      },
    });

    return NextResponse.json({ id: meta.id }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: logAndRedact("[meetings] create failed", err) },
      { status: 500 }
    );
  }
}

/** `?pending=1` — transcripts that finished but never landed in a page, plus
 *  recordings abandoned mid-capture. Drives the post-crash recovery prompt. */
export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get("pending") !== "1") {
      return NextResponse.json({ error: "Unsupported query." }, { status: 400 });
    }
    return NextResponse.json({ recordings: await listPending() });
  } catch (err) {
    return NextResponse.json(
      { error: logAndRedact("[meetings] list failed", err) },
      { status: 500 }
    );
  }
}
