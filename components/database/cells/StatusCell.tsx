"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import type { DbPropertyOption, DbStatusGroup, DbValue } from "@/lib/db/types";
import { optionChipClasses } from "@/components/database/optionColors";
import OptionDropdown, { type OptionGroup } from "@/components/database/cells/OptionDropdown";

const STATUS_GROUPS: OptionGroup[] = [
  { key: "todo", label: "To-do" },
  { key: "in_progress", label: "In progress" },
  { key: "complete", label: "Complete" },
];

/** Select-style chip whose dropdown groups options under status_group headings. */
export default function StatusCell({
  value,
  options,
  onChange,
  onCreateOption,
}: {
  value: DbValue;
  options: DbPropertyOption[];
  onChange: (next: DbValue) => void;
  onCreateOption: (label: string, statusGroup: DbStatusGroup) => Promise<DbPropertyOption>;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedId = typeof value === "string" ? value : null;
  const selected = options.find((o) => o.id === selectedId) ?? null;

  const handleCreate = async (label: string) => {
    // New status options default to the "To-do" group.
    const option = await onCreateOption(label, "todo");
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
        groups={STATUS_GROUPS}
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
