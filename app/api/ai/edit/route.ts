import "server-only";

import type { NextRequest } from "next/server";
import { getLLMProvider } from "@/lib/llm/registry";

const TOOLS = ["summarize", "format", "organize", "rewrite", "continue"] as const;
type Tool = (typeof TOOLS)[number];

function isTool(value: unknown): value is Tool {
  return typeof value === "string" && (TOOLS as readonly string[]).includes(value);
}

interface EditRequestBody {
  tool: Tool;
  text: string;
  instruction?: string;
  breadcrumb?: string;
}

const RETURN_TEXT_ONLY =
  "You edit the user's note text. Return ONLY the replacement text — no preamble, no explanations, no markdown code fences.";

/** Per-tool system prompt appended to the shared "return only the text" instruction. */
function systemPromptFor(tool: Tool, instruction: string | undefined): string {
  switch (tool) {
    case "summarize":
      return `${RETURN_TEXT_ONLY} Write a concise summary of the given text that preserves all key facts.`;
    case "format":
      return `${RETURN_TEXT_ONLY} Fix formatting, punctuation, capitalization, and spacing without changing the meaning or wording of the text.`;
    case "organize":
      return `${RETURN_TEXT_ONLY} Restructure the text into logical sections with headings and bullet points as needed, preserving all of its content.`;
    case "rewrite":
      return `${RETURN_TEXT_ONLY} Apply the user's instruction to rewrite the text. Instruction: ${instruction}`;
    case "continue":
      return `${RETURN_TEXT_ONLY} Continue writing naturally from the given text, matching its tone and style. Write one to three paragraphs and do not repeat the given text.`;
  }
}

function userPromptFor(text: string, breadcrumb: string | undefined): string {
  return breadcrumb ? `Context: ${breadcrumb}\n\n${text}` : text;
}

function sseEvent(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Category-B AI editing tools: propose only, never writes to the database.
 * Streams `{type:'delta', text}` … `{type:'done'}` (SSE `data:` lines,
 * matching the /api/ai/chat wire format) so the client can render a live
 * proposal and let the user accept/reject via the normal editor transaction
 * → saveBlocksAction path.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let body: Partial<EditRequestBody>;
  try {
    body = (await req.json()) as Partial<EditRequestBody>;
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const { tool, text, instruction, breadcrumb } = body;
  if (!isTool(tool)) {
    return jsonError(`invalid tool: ${String(tool)}`, 400);
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return jsonError("text is required", 400);
  }
  if (tool === "rewrite" && (typeof instruction !== "string" || instruction.trim().length === 0)) {
    return jsonError("instruction is required for the rewrite tool", 400);
  }

  const system = systemPromptFor(tool, instruction);
  const user = userPromptFor(text, breadcrumb);
  const provider = await getLLMProvider();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of provider.chatStream({
          system,
          messages: [{ role: "user", content: user }],
          signal: req.signal,
        })) {
          if (delta.text) controller.enqueue(sseEvent({ type: "delta", text: delta.text }));
        }
        controller.enqueue(sseEvent({ type: "done" }));
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          controller.enqueue(
            sseEvent({
              type: "error",
              message: err instanceof Error ? err.message : String(err),
            })
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
