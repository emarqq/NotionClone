import "server-only";

import type { NextRequest } from "next/server";
import { checkWord } from "@/lib/spellcheck";

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Looks up a single word against the bundled en dictionary and returns a
 * correction only when one clears the auto-apply confidence bar. Used by
 * the editor's autocorrect extension — kept server-side so the ~1MB
 * dictionary never ships to the client.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let body: { word?: unknown };
  try {
    body = (await req.json()) as { word?: unknown };
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const { word } = body;
  if (typeof word !== "string" || word.trim().length === 0) {
    return jsonError("word is required", 400);
  }

  const result = await checkWord(word);
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
}
