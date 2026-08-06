import { CalendarDays, Clock, Home, Star } from "lucide-react";
import type { Page, Space } from "@/lib/db/types";
import {
  getFavorites,
  getPageTree,
  getRecents,
  getSpaces,
} from "@/lib/db/pages";
import AskAiLink from "./AskAiLink";
import CollapsibleSection from "./CollapsibleSection";
import FlatPageRow from "./FlatPageRow";
import NewSpaceButton from "./NewSpaceButton";
import SidebarLink from "./SidebarLink";
import SpaceSection from "./SpaceSection";

/** Flat page rows for the Favorites / Recents sections. */
function PageLinkList({
  pages,
  slugBySpaceId,
  spaces,
}: {
  pages: Page[];
  slugBySpaceId: Map<string, string>;
  spaces: Space[];
}) {
  return (
    <div>
      {pages.map((page) => {
        const slug = slugBySpaceId.get(page.space_id);
        if (!slug) return null;
        return (
          <FlatPageRow
            key={page.id}
            page={page}
            spaceSlug={slug}
            spaces={spaces}
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
    <aside className="flex h-full w-full min-w-0 flex-col overflow-y-auto border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="app-sidebar-header px-4 pb-2 pt-4">
        <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
          Notion Clone
        </p>
      </div>
      <nav className="flex-1 space-y-5 px-2 pb-8 pt-2">
        <section>
          <SidebarLink href="/home" label="Home" icon={<Home size={14} />} />
          <SidebarLink
            href="/calendar"
            label="Calendar"
            icon={<CalendarDays size={14} />}
          />
          <AskAiLink />
        </section>
        {favorites.length > 0 && (
          <CollapsibleSection
            storageKey="sidebar:favorites-collapsed"
            label="Favorites"
            icon={<Star size={13} />}
          >
            <PageLinkList
              pages={favorites}
              slugBySpaceId={slugBySpaceId}
              spaces={spaces}
            />
          </CollapsibleSection>
        )}
        {recents.length > 0 && (
          <CollapsibleSection
            storageKey="sidebar:recents-collapsed"
            label="Recents"
            icon={<Clock size={13} />}
          >
            <PageLinkList
              pages={recents}
              slugBySpaceId={slugBySpaceId}
              spaces={spaces}
            />
          </CollapsibleSection>
        )}
        {spaces.map((space, index) => (
          <SpaceSection
            key={space.id}
            space={space}
            spaces={spaces}
            tree={trees[index]}
          />
        ))}
        <section>
          <NewSpaceButton />
        </section>
      </nav>
    </aside>
  );
}
