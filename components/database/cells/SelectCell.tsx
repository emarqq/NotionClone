"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import type { DbPropertyOption, DbValue } from "@/lib/db/types";
import { optionChipClasses } from "@/components/database/optionColors";
import OptionDropdown from "@/components/database/cells/OptionDropdown";

/** Single-select chip; click opens a portal dropdown to set/clear/create. */
export default function SelectCell({
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
  const selectedId = typeof value === "string" ? value : null;
  const selected = options.find((o) => o.id === selectedId) ?? null;

  const handleCreate = async (label: string) => {
    const option = await onCreateOption(label);
    onChange(option.id);
  };

  return (
    <div ref={anchorRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[26px] w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        {selected ? (
          <span
            className={clsx(
              "truncate rounded px-1.5 py-0.5 text-xs",
              optionChipClasses(selected.color)
            )}
          >
            {selected.label}
          </span>
        ) : (
          <span className="text-xs text-neutral-300 dark:text-neutral-600">Empty</span>
        )}
      </button>
      <OptionDropdown
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        options={options}
        selectedIds={selectedId ? [selectedId] : []}
        multi={false}
        onToggle={(id) => {
          onChange(id);
          setOpen(false);
        }}
        onClear={() => onChange(null)}
        onCreate={handleCreate}
      />
    </div>
  );
}
