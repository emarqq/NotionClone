"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, X } from "lucide-react";
import clsx from "clsx";
import type { DbPropertyOption } from "@/lib/db/types";
import { optionChipClasses } from "@/components/database/optionColors";
import { usePortalPosition } from "@/components/database/usePortalPosition";

export interface OptionGroup {
  key: string;
  label: string;
}

/**
 * Shared portal dropdown backing SelectCell, MultiSelectCell and StatusCell:
 * a filter input, a position-ordered (optionally grouped) option list,
 * type-to-create when the filter matches nothing, and a "None" clear row for
 * single-select variants.
 */
export default function OptionDropdown({
  open,
  anchorRef,
  onClose,
  options,
  selectedIds,
  multi,
  groups,
  onToggle,
  onClear,
  onCreate,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  options: DbPropertyOption[];
  selectedIds: string[];
  multi: boolean;
  /** When set, options are grouped/headed by `option.status_group` in this order. */
  groups?: OptionGroup[];
  onToggle: (optionId: string) => void;
  onClear: () => void;
  onCreate: (label: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");
  const style = usePortalPosition(anchorRef, panelRef, open);

  useEffect(() => {
    if (open) setFilter("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, filter]);

  const exactMatch = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return options.some((o) => o.label.toLowerCase() === q);
  }, [options, filter]);

  if (!open) return null;

  const renderOption = (option: DbPropertyOption) => {
    const selected = selectedIds.includes(option.id);
    return (
      <button
        key={option.id}
        type="button"
        onClick={() => onToggle(option.id)}
        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        <span
          className={clsx(
            "truncate rounded px-1.5 py-0.5 text-xs",
            optionChipClasses(option.color)
          )}
        >
          {option.label}
        </span>
        {multi && selected && (
          <Check size={13} className="shrink-0 text-neutral-500 dark:text-neutral-400" />
        )}
      </button>
    );
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} />
      <div
        ref={panelRef}
        style={style}
        className="z-30 w-60 rounded-md border border-neutral-200 bg-white p-1.5 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      >
        <input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          placeholder="Search or create…"
          className="mb-1.5 w-full rounded border border-neutral-200 bg-white px-2 py-1 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:focus:border-neutral-500"
        />
        <div className="max-h-56 overflow-y-auto">
          {!multi && selectedIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onClear();
                onClose();
              }}
              className="mb-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <X size={13} className="shrink-0" />
              None
            </button>
          )}
          {groups
            ? groups.map((group) => {
                const groupOptions = filtered.filter(
                  (o) => (o.status_group ?? groups[0].key) === group.key
                );
                if (groupOptions.length === 0) return null;
                return (
                  <div key={group.key} className="mb-1">
                    <p className="px-2 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-600">
                      {group.label}
                    </p>
                    {groupOptions.map(renderOption)}
                  </div>
                );
              })
            : filtered.map(renderOption)}
          {filter.trim() && !exactMatch && (
            <button
              type="button"
              onClick={() => {
                onCreate(filter.trim());
                onClose();
              }}
              className="mt-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <Plus size={13} className="shrink-0" />
              Create &quot;{filter.trim()}&quot;
            </button>
          )}
          {filtered.length === 0 && !filter.trim() && (
            <p className="px-2 py-1 text-xs italic text-neutral-400 dark:text-neutral-600">
              No options yet
            </p>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
