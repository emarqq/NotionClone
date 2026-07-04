import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, Plus } from "lucide-react";
import { getPageTree, getSpaceBySlug } from "@/lib/db/pages";
import NewMeetingNoteButton from "@/components/sidebar/NewMeetingNoteButton";
import NewPageButton from "@/components/sidebar/NewPageButton";

export const dynamic = "force-dynamic";

export default async function SpacePage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>;
}) {
  const { spaceSlug } = await params;
  const space = await getSpaceBySlug(spaceSlug);
  if (!space) notFound();
  const tree = await getPageTree(space.id);

  return (
    <div className="mx-auto max-w-2xl px-8 py-16">
      <h1 className="flex items-center gap-3 text-3xl font-bold text-neutral-900 dark:text-neutral-100">
        {space.icon && <span>{space.icon}</span>}
        <span>{space.name}</span>
      </h1>

      <div className="mt-10 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Pages
        </h2>
        <div className="flex items-center gap-2">
          <NewPageButton
            spaceId={space.id}
            spaceSlug={space.slug}
            title={`New page in ${space.name}`}
            className="flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <Plus size={14} />
            New page
          </NewPageButton>
          <NewMeetingNoteButton
            spaceId={space.id}
            spaceSlug={space.slug}
            title="New meeting note"
            className="flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <CalendarPlus size={14} />
            New meeting note
          </NewMeetingNoteButton>
        </div>
      </div>

      <ul className="mt-3">
        {tree.map((page) => (
          <li key={page.id}>
            <Link
              href={`/${space.slug}/${page.id}`}
              className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800/70"
            >
              <span>{page.icon ?? "📄"}</span>
              <span className="truncate">{page.title}</span>
              {page.children.length > 0 && (
                <span className="ml-auto shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                  {page.children.length}{" "}
                  {page.children.length === 1 ? "sub-page" : "sub-pages"}
                </span>
              )}
            </Link>
          </li>
        ))}
        {tree.length === 0 && (
          <li className="px-2 py-4 text-sm text-neutral-400 dark:text-neutral-500">
            No pages yet — create your first one.
          </li>
        )}
      </ul>
    </div>
  );
}
