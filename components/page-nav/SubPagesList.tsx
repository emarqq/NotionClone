import Link from "next/link";
import type { Page } from "@/lib/db/types";
import { DefaultPageIcon, PageIcon } from "@/lib/icons";

/**
 * In-body "Sub-pages" list rendered at the bottom of a page's content, below
 * the editor blocks. Server-rendered (no interactivity beyond navigation), so
 * it just needs the direct, non-archived children. Renders nothing when the
 * page has no children.
 */
export default function SubPagesList({
  pages,
  spaceSlug,
}: {
  pages: Page[];
  spaceSlug: string;
}) {
  if (pages.length === 0) return null;

  return (
    <section className="mt-10 border-t border-neutral-200 pt-4 dark:border-neutral-800">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-600">
        Sub-pages
      </p>
      <ul>
        {pages.map((page) => (
          <li key={page.id}>
            <Link
              href={`/${spaceSlug}/${page.id}`}
              className="flex items-center gap-2 rounded-md px-1 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
            >
              <span className="flex w-5 shrink-0 items-center justify-center leading-none">
                <PageIcon icon={page.icon} size={14} fallback={<DefaultPageIcon size={14} />} />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {page.title || "Untitled"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
