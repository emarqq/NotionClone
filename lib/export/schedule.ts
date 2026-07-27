import "server-only";

import { after } from "next/server";

import { getChildren } from "@/lib/db/pages";
import { getBacklinks } from "@/lib/db/links";
import { deletePageExport, exportPage } from "./exportPage";

/**
 * Fire-and-forget vault-export hooks, mirroring editor.ts's scheduleIngest:
 * each runs in an after() so a failing export never breaks the caller's save.
 */

/** Re-mirror one page after a content/metadata/move change. */
export function scheduleExport(pageId: string): void {
  after(() =>
    exportPage(pageId).catch((err) =>
      console.error(`scheduleExport failed for page ${pageId}:`, err)
    )
  );
}

/**
 * Re-mirror after a title change: the page itself (new filename/frontmatter),
 * its direct children (their `parent` wikilink), and every page that links to
 * it (their inbound `[[oldName]]` would otherwise break). The page must go
 * first so children/backlinks resolve against its new manifest segment.
 */
export function scheduleExportRename(pageId: string): void {
  after(async () => {
    try {
      await exportPage(pageId);
      const [children, backlinks] = await Promise.all([
        getChildren(pageId),
        getBacklinks(pageId),
      ]);
      for (const child of children) await exportPage(child.id);
      for (const source of backlinks) await exportPage(source.pageId);
    } catch (err) {
      console.error(`scheduleExportRename failed for page ${pageId}:`, err);
    }
  });
}

/** Remove a page (and its subtree) from the vault after a hard delete. */
export function scheduleDelete(pageId: string): void {
  after(() =>
    deletePageExport(pageId).catch((err) =>
      console.error(`scheduleDelete failed for page ${pageId}:`, err)
    )
  );
}
