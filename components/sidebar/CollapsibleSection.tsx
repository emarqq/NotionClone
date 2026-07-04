"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";

/**
 * Sidebar section with a collapsible header (Favorites / Recents).
 * Default open; collapsed state persisted per-section in localStorage.
 */
export default function CollapsibleSection({
  storageKey,
  label,
  icon,
  children,
}: {
  /** localStorage key holding "1" when collapsed. */
  storageKey: string;
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  // Default open on the server render; hydrate the stored state on mount.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(storageKey) === "1") setCollapsed(true);
    } catch {
      // localStorage unavailable (private mode etc.) — stay open.
    }
  }, [storageKey]);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // Ignore persistence failures; the in-memory state still toggles.
      }
      return next;
    });
  };

  return (
    <section>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="group/section flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        <span className="flex w-4 shrink-0 items-center justify-center">
          {icon}
        </span>
        <span className="truncate">{label}</span>
        <ChevronRight
          size={12}
          className={clsx(
            "ml-auto shrink-0 opacity-0 transition-transform group-hover/section:opacity-100",
            !collapsed && "rotate-90"
          )}
        />
      </button>
      {!collapsed && children}
    </section>
  );
}
