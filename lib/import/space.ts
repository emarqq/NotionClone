import "server-only";

import type { Space } from "@/lib/db/types";
import { getSpaceBySlug, createSpace } from "@/lib/db/pages";

/** Slug of the dedicated space that holds all imported reference docs. */
export const IMPORTED_SPACE_SLUG = "imported";

/**
 * Get (or create on first import) the dedicated "Imported" space. All imported
 * files + chunks land here so reference context is isolated from School/Work
 * and toggleable via the AI panel's existing per-space filter.
 */
export async function getOrCreateImportedSpace(): Promise<Space> {
  const existing = await getSpaceBySlug(IMPORTED_SPACE_SLUG);
  if (existing) return existing;
  // createSpace slugifies "Imported" → "imported", matching IMPORTED_SPACE_SLUG.
  return createSpace({ name: "Imported", icon: "📥" });
}
