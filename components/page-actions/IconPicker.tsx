"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { PAGE_ICON_GROUPS, PageIcon } from "@/lib/icons";

/**
 * Grid picker for the curated page-icon set (see `lib/icons.tsx`), grouped by
 * category with a name filter. Replaces the old free-text emoji input.
 */
export default function IconPicker({
  value,
  onSelect,
  onClear,
  onClose,
}: {
  value: string | null;
  onSelect: (icon: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PAGE_ICON_GROUPS;
    return PAGE_ICON_GROUPS.map((g) => ({
      ...g,
      icons: g.icons.filter((name) => name.toLowerCase().includes(q)),
    })).filter((g) => g.icons.length > 0);
  }, [query]);

  return (
    <div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        placeholder="Search icons…"
        className="mb-2 w-full rounded border border-neutral-200 bg-white px-2 py-1 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:focus:border-neutral-500"
      />
      <div className="max-h-64 overflow-y-auto pr-1">
        {groups.length === 0 && (
          <p className="px-0.5 py-2 text-xs text-neutral-400 dark:text-neutral-500">
            No icons match &ldquo;{query}&rdquo;
          </p>
        )}
        {groups.map((g) => (
          <div key={g.label} className="mb-2 last:mb-0">
            <p className="mb-1 px-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              {g.label}
            </p>
            <div className="grid grid-cols-8 gap-0.5">
              {g.icons.map((name) => (
                <button
                  key={name}
                  type="button"
                  title={name}
                  onClick={() => onSelect(name)}
                  className={clsx(
                    "flex h-7 w-7 items-center justify-center rounded text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
                    value === name &&
                      "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100",
                  )}
                >
                  <PageIcon icon={name} size={15} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {value && (
        <button
          type="button"
          onClick={onClear}
          className="mt-2 w-full rounded px-2 py-1 text-left text-xs text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
        >
          Remove icon
        </button>
      )}
    </div>
  );
}
