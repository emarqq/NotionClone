"use client";

import { useCallback, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { createPageAction } from "@/app/actions/pages";
import { useTabsStore } from "./store";

export interface SpaceOption {
  id: string;
  slug: string;
  name: string;
}

/**
 * Creates a new page in the current space (from the route's spaceSlug, falling
 * back to the first space), opens it in a new tab, and navigates to it.
 * Shared by the TabBar "+" button and the Cmd+T shortcut in AppShell.
 */
export function useNewTab(spaces: SpaceOption[]) {
  const router = useRouter();
  const params = useParams<{ spaceSlug?: string }>();
  const [isCreating, startTransition] = useTransition();

  const spaceSlug =
    typeof params?.spaceSlug === "string" ? params.spaceSlug : undefined;

  const createNewTab = useCallback(() => {
    const space = spaces.find((s) => s.slug === spaceSlug) ?? spaces[0];
    if (!space) return;
    startTransition(async () => {
      const page = await createPageAction(space.id, space.slug);
      useTabsStore.getState().openInNewTab({
        pageId: page.id,
        spaceSlug: space.slug,
        title: page.title || "Untitled",
      });
      router.push(`/${space.slug}/${page.id}`);
    });
  }, [spaces, spaceSlug, router]);

  return { createNewTab, isCreating };
}
