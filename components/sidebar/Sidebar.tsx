import { Clock, Home, Star } from "lucide-react";
import type { Page, Space } from "@/lib/db/types";
import {
  getFavorites,
  getPageTree,
  getRecents,
  getSpaces,
} from "@/lib/db/pages";
import CollapsibleSection from "./CollapsibleSection";
import SidebarLink from "./SidebarLink";
import SpaceSection from "./SpaceSection";

/** Flat page rows for the Favorites / Recents sections. */
function PageLinkList({
  pages,
  slugBySpaceId,
}: {
  pages: Page[];
  slugBySpaceId: Map<string, string>;
}) {
  return (
    <div>
      {pages.map((page) => {
        const slug = slugBySpaceId.get(page.space_id);
        if (!slug) return null;
        return (
          <SidebarLink
            key={page.id}
            href={`/${slug}/${page.id}`}
            label={page.title}
            icon={
              <span className="text-sm leading-none">{page.icon ?? "📄"}</span>
            }
          />
        );
      })}
    </div>
  );
}

/** App sidebar: loads all spaces and their page trees on the server. */
export default async function Sidebar() {
  const [spaces, favorites, recents] = await Promise.all([
    getSpaces(),
    getFavorites(),
    getRecents(8),
  ]);
  const trees = await Promise.all(spaces.map((space) => getPageTree(space.id)));
  const slugBySpaceId = new Map(
    spaces.map((space: Space) => [space.id, space.slug])
  );

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="px-4 pb-2 pt-4">
        <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
          Knowledge Hub
        </p>
      </div>
      <nav className="flex-1 space-y-5 px-2 pb-8 pt-2">
        <section>
          <SidebarLink href="/home" label="Home" icon={<Home size={14} />} />
        </section>
        {favorites.length > 0 && (
          <CollapsibleSection
            storageKey="sidebar:favorites-collapsed"
            label="Favorites"
            icon={<Star size={13} />}
          >
            <PageLinkList pages={favorites} slugBySpaceId={slugBySpaceId} />
          </CollapsibleSection>
        )}
        {recents.length > 0 && (
          <CollapsibleSection
            storageKey="sidebar:recents-collapsed"
            label="Recents"
            icon={<Clock size={13} />}
          >
            <PageLinkList pages={recents} slugBySpaceId={slugBySpaceId} />
          </CollapsibleSection>
        )}
        {spaces.map((space, index) => (
          <SpaceSection key={space.id} space={space} tree={trees[index]} />
        ))}
      </nav>
    </aside>
  );
}
