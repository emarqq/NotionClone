import Link from "next/link";
import { getFavorites, getRecents, getSpaces } from "@/lib/db/pages";
import type { Page, Space } from "@/lib/db/types";
import { DefaultPageIcon, PageIcon } from "@/lib/icons";
import AskBrainBar from "@/components/ai-panel/AskBrainBar";

export const dynamic = "force-dynamic";

function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatEdited(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function PageCardGrid({
  pages,
  spaceById,
  emptyText,
}: {
  pages: Page[];
  spaceById: Map<string, Space>;
  emptyText: string;
}) {
  const cards = pages.filter((page) => spaceById.has(page.space_id));

  if (cards.length === 0) {
    return (
      <p className="mt-3 text-sm text-neutral-400 dark:text-neutral-500">
        {emptyText}
      </p>
    );
  }

  return (
    <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((page) => {
        const space = spaceById.get(page.space_id)!;
        return (
          <li key={page.id}>
            <Link
              href={`/${space.slug}/${page.id}`}
              className="block rounded-lg border border-neutral-200 bg-white px-4 py-3 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/70"
            >
              <div className="flex items-center gap-2">
                <PageIcon
                  icon={page.icon}
                  size={18}
                  className="shrink-0 text-neutral-500 dark:text-neutral-400"
                  fallback={<DefaultPageIcon size={18} />}
                />
                <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {page.title}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
                <span className="flex min-w-0 items-center gap-1 truncate">
                  <PageIcon icon={space.icon} size={12} className="shrink-0" />
                  {space.name}
                </span>
                <span aria-hidden>·</span>
                <span className="shrink-0">
                  Edited {formatEdited(page.updated_at)}
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function HomePage() {
  const [spaces, recents, favorites] = await Promise.all([
    getSpaces(),
    getRecents(),
    getFavorites(),
  ]);
  const spaceById = new Map(spaces.map((space) => [space.id, space]));

  return (
    <div className="mx-auto max-w-4xl px-8 py-16">
      <h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">
        Home
      </h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        {greetingForNow()} — pick up where you left off.
      </p>

      <div className="mt-6">
        <AskBrainBar />
      </div>

      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Recents
        </h2>
        <PageCardGrid
          pages={recents}
          spaceById={spaceById}
          emptyText="Nothing viewed yet — open a page and it will show up here."
        />
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Favorites
        </h2>
        <PageCardGrid
          pages={favorites}
          spaceById={spaceById}
          emptyText="No favorites yet — star a page to pin it here."
        />
      </section>
    </div>
  );
}
