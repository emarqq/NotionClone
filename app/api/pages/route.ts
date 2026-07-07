import "server-only";

import { getAllPages } from "@/lib/db/pages";

// The page list changes as pages are created/renamed/archived; never cache.
export const dynamic = "force-dynamic";

/**
 * Returns all non-archived pages as flat `{ id, title, spaceSlug, icon }`
 * options for the editor's mention popup. `lib/db/*` is server-only, so the
 * client reaches the page list through this handler (mirrors /api/spellcheck).
 */
export async function GET(): Promise<Response> {
  try {
    const pages = await getAllPages();
    return new Response(JSON.stringify({ pages }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Failed to load pages",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
