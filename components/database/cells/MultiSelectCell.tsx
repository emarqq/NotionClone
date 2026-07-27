"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import type { DbPropertyOption, DbValue } from "@/lib/db/types";
import { optionChipClasses } from "@/components/database/optionColors";
import OptionDropdown from "@/components/database/cells/OptionDropdown";

/** Multi-select chips row; dropdown toggles membership (checkmarks). */
export default function MultiSelectCell({
  value,
  options,
  onChange,
  onCreateOption,
}: {
  value: DbValue;
  options: DbPropertyOption[];
  onChange: (next: DbValue) => void;
  onCreateOption: (label: string) => Promise<DbPropertyOption>;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIds = Array.isArray(value) ? value : [];
  const selectedOptions = selectedIds
    .map((id) => options.find((o) => o.id === id))
    .filter((o): o is DbPropertyOption => Boolean(o));

  const toggle = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((v) => v !== id)
      : [...selectedIds, id];
    onChange(next.length > 0 ? next : null);
  };

  const handleCreate = async (label: string) => {
    const option = await onCreateOption(label);
    toggle(option.id);
  };

  return (
    <div ref={anchorRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[26px] w-full flex-wrap items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        {selectedOptions.length > 0 ? (
          selectedOptions.map((o) => (
            <span
              key={o.id}
              className={clsx(
                "truncate rounded px-1.5 py-0.5 text-xs",
                optionChipClasses(o.color)
              )}
            >
              {o.label}
            </span>
          ))
        ) : (
          <span className="text-xs text-neutral-300 dark:text-neutral-600">Empty</span>
        )}
      </button>
      <OptionDropdown
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        options={options}
        selectedIds={selectedIds}
        multi
        onToggle={toggle}
        onClear={() => onChange(null)}
        onCreate={handleCreate}
      />
    </div>
  );
}
