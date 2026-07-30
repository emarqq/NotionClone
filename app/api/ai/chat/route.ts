import "server-only";

import type { NextRequest } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/server";
import { retrieve, type RetrievedSource } from "@/lib/rag/retriever";
import { buildRagPrompt } from "@/lib/rag/prompt";
import { getLLMProvider } from "@/lib/llm/registry";
import type { ChatMessage } from "@/lib/llm/types";
import {
  addMessage,
  createConversation,
  getConversation,
  getMessages,
} from "@/lib/db/ai";
import type { Json } from "@/lib/db/types";

const HISTORY_LIMIT = 8;
const TITLE_MAX_LENGTH = 60;

interface ChatRequestBody {
  conversationId?: string;
  message: string;
  spaceId?: string | null;
  /** Graph-RAG: also pull chunks from linked pages (see lib/rag/retriever). */
  graphExpand?: boolean;
}

/** RetrievedSource plus the display metadata the panel needs to render a clickable citation. */
export interface EnrichedSource extends RetrievedSource {
  spaceSlug: string | null;
  href: string | null;
  label: string;
}

function sseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Adds spaceSlug + a clickable href to each retrieved source: pages link to
 * their own route, files link to the page they're attached to (files.page_id)
 * with the filename (already `title` from hybrid_search) as the label.
 */
async function enrichSources(
  sources: RetrievedSource[]
): Promise<EnrichedSource[]> {
  if (sources.length === 0) return [];
  const supabase = createServiceSupabase();

  const spaceIds = Array.from(new Set(sources.map((s) => s.spaceId)));
  const { data: spacesData, error: spacesError } = await supabase
    .from("spaces")
    .select("id, slug")
    .in("id", spaceIds);
  if (spacesError) {
    throw new Error(`enrichSources spaces lookup failed: ${spacesError.message}`);
  }
  const slugBySpaceId = new Map(
    (spacesData ?? []).map((s) => [s.id as string, s.slug as string])
  );

  const fileIds = sources
    .filter((s) => s.sourceType === "file" && s.fileId)
    .map((s) => s.fileId as string);
  const pageIdByFileId = new Map<string, string | null>();
  if (fileIds.length > 0) {
    const { data: filesData, error: filesError } = await supabase
      .from("files")
      .select("id, page_id")
      .in("id", fileIds);
    if (filesError) {
      throw new Error(`enrichSources files lookup failed: ${filesError.message}`);
    }
    for (const row of filesData ?? []) {
      pageIdByFileId.set(
        row.id as string,
        (row.page_id as string | null) ?? null
      );
    }
  }

  return sources.map((source) => {
    const spaceSlug = slugBySpaceId.get(source.spaceId) ?? null;
    if (source.sourceType === "page") {
      return {
        ...source,
        spaceSlug,
        href: spaceSlug && source.pageId ? `/${spaceSlug}/${source.pageId}` : null,
        label: source.title,
      };
    }
    const attachedPageId = source.fileId
      ? pageIdByFileId.get(source.fileId) ?? null
      : null;
    return {
      ...source,
      spaceSlug,
      href: spaceSlug && attachedPageId ? `/${spaceSlug}/${attachedPageId}` : null,
      label: source.title,
    };
  });
}

/**
 * Streaming RAG chat endpoint. Wire format (text/event-stream, `data: <json>\n\n`):
 *   {type:'meta', conversationId, sources} → {type:'delta', text}* → {type:'done'}
 * or {type:'error', message} on failure. Persists the user message before
 * streaming and the assistant message (with sources) after the stream ends.
 */
export async function POST(request: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400,
    });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return new Response(JSON.stringify({ error: "message is required." }), {
      status: 400,
    });
  }
  const spaceId = body.spaceId ?? null;
  const graphExpand = body.graphExpand ?? false;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(payload)));
      };

      try {
        let conversationId = body.conversationId;
        let priorMessages: ChatMessage[] = [];

        // A client-supplied conversationId can be stale (e.g. persisted in
        // localStorage from before a deleted/reset conversation table) —
        // fall back to starting a fresh conversation rather than crashing.
        const existing = conversationId
          ? await getConversation(conversationId)
          : null;

        if (existing) {
          const history = await getMessages(conversationId!);
          priorMessages = history
            .slice(-HISTORY_LIMIT)
            .map((m) => ({ role: m.role, content: m.content }));
        } else {
          const conversation = await createConversation(
            message.slice(0, TITLE_MAX_LENGTH),
            spaceId
          );
          conversationId = conversation.id;
        }
        if (!conversationId) {
          throw new Error("conversationId missing after conversation resolution");
        }

        await addMessage(conversationId, "user", message);

        const sources = await retrieve(message, {
          spaceId,
          k: 8,
          expand: graphExpand,
          hops: 1,
          signal: request.signal,
        });
        const enriched = await enrichSources(sources);

        send({ type: "meta", conversationId, sources: enriched });

        const { system, user } = buildRagPrompt(message, sources);
        const chatMessages: ChatMessage[] = [
          ...priorMessages,
          { role: "user", content: user },
        ];

        const provider = await getLLMProvider();

        let fullText = "";
        let aborted = false;
        try {
          for await (const delta of provider.chatStream({
            messages: chatMessages,
            system,
            signal: request.signal,
          })) {
            if (request.signal.aborted) {
              aborted = true;
              break;
            }
            if (delta.text) {
              fullText += delta.text;
              send({ type: "delta", text: delta.text });
            }
          }
        } catch (streamError) {
          if (request.signal.aborted) {
            aborted = true;
          } else {
            throw streamError;
          }
        }

        // On client abort we keep the partial answer (tagged) rather than
        // discarding it — losing a half-finished answer the user already
        // skimmed is worse than labeling it as interrupted.
        if (fullText.length > 0) {
          const content = aborted
            ? `${fullText}\n\n_(response interrupted)_`
            : fullText;
          await addMessage(
            conversationId,
            "assistant",
            content,
            enriched as unknown as Json
          );
        }

        if (!aborted) send({ type: "done" });
        controller.close();
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : "Unknown error";
        try {
          send({ type: "error", message: errMessage });
        } catch {
          // Controller may already be closed if the client disconnected.
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
