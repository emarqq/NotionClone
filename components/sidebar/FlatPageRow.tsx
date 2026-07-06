"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import clsx from "clsx";
import type { Page } from "@/lib/db/types";
import PageActionsMenu, { type MenuSpace } from "@/components/page-actions/PageActionsMenu";
import { DefaultPageIcon, PageIcon } from "@/lib/icons";

const HOVER_BTN_CLASS =
  "flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-300/70 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-neutral-200";

/**
 * Flat sidebar page row (Favorites / Recents) with the shared three-dot menu —
 * the same options as the page-tree rows, minus the tree-only affordances
 * (expand, new child, drag-and-drop).
 */
export default function FlatPageRow({
  page,
  spaceSlug,
  spaces,
}: {
  page: Page;
  spaceSlug: string;
  spaces: MenuSpace[];
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const href = `/${spaceSlug}/${page.id}`;
  const isActive = pathname === href;

  return (
    <div
      className={clsx(
        "group/row relative flex items-center gap-1.5 rounded-md px-2 py-1 text-sm",
        isActive
          ? "bg-neutral-200/80 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
          : "text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800/70"
      )}
    >
      <span className="flex w-4 shrink-0 items-center justify-center leading-none">
        <PageIcon icon={page.icon} size={14} fallback={<DefaultPageIcon size={14} />} />
      </span>
      <Link href={href} className="min-w-0 flex-1 truncate">
        {page.title}
      </Link>
      <button
        type="button"
        title="More actions"
        aria-label="More actions"
        className={clsx(
          HOVER_BTN_CLASS,
          "shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100",
          menuOpen && "opacity-100"
        )}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <MoreHorizontal size={13} />
      </button>
      <PageActionsMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        page={page}
        spaceSlug={spaceSlug}
        spaces={spaces}
        align="right-1"
      />
    </div>
  );
}
