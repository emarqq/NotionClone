import "server-only";

import { getThreadsForPage } from "@/lib/db/comments";

// Threads change as the user comments/replies/resolves; never cache.
export const dynamic = "force-dynamic";

/**
 * Returns all comment threads (with their messages) for a page as
 * `{ threads }`. `lib/db/*` is server-only, so the client comment panel and
 * thread popover reach the data through this handler (mirrors /api/pages).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const pageId = new URL(request.url).searchParams.get("pageId");
    if (!pageId) {
      return new Response(JSON.stringify({ error: "pageId is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const threads = await getThreadsForPage(pageId);
    return new Response(JSON.stringify({ threads }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Failed to load comments",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
