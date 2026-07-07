import Link from "next/link";

import { getBacklinks } from "@/lib/db/links";
import { DefaultPageIcon, PageIcon } from "@/lib/icons";

/**
 * "Linked references" section rendered below the editor: the distinct pages
 * that mention/link to this one. Async server component (template =
 * SubPagesList / AttachmentsPanel) — renders nothing when there are no
 * backlinks. Link sync runs in `after()` on save, so a new backlink appears
 * on the next load of the target page (page.tsx is force-dynamic).
 */
export default async function Backlinks({ pageId }: { pageId: string }) {
  const backlinks = await getBacklinks(pageId);
  if (backlinks.length === 0) return null;

  return (
    <section className="mt-10 border-t border-neutral-200 pt-4 dark:border-neutral-800">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-600">
        Linked references
      </p>
      <ul>
        {backlinks.map((b) => (
          <li key={b.pageId}>
            <Link
              href={`/${b.spaceSlug}/${b.pageId}`}
              className="flex items-center gap-2 rounded-md px-1 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
            >
              <span className="flex w-5 shrink-0 items-center justify-center leading-none">
                <PageIcon icon={b.icon} size={14} fallback={<DefaultPageIcon size={14} />} />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {b.title || "Untitled"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
