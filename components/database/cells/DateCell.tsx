"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { DbDateValue, DbValue } from "@/lib/db/types";

/**
 * Parses a "YYYY-MM-DD" string as LOCAL date parts — `new Date(y, m-1, d)` —
 * never `new Date("YYYY-MM-DD")`, which parses as UTC and renders a day off
 * in negative-UTC-offset timezones.
 */
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function readDate(value: DbValue): DbDateValue | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as DbDateValue;
}

/** Displays a formatted date; click opens a native date input inline. */
export default function DateCell({
  value,
  onChange,
}: {
  value: DbValue;
  onChange: (next: DbValue) => void;
}) {
  const [editing, setEditing] = useState(false);
  const dateValue = readDate(value);
  const display = dateValue?.start ? parseLocalDate(dateValue.start).toLocaleDateString() : null;

  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        defaultValue={dateValue?.start ?? ""}
        onBlur={(e) => {
          setEditing(false);
          const next = e.target.value;
          if (!next) return;
          onChange({ start: next, end: null, hasTime: false });
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter") {
            setEditing(false);
            const next = e.currentTarget.value;
            if (next) onChange({ start: next, end: null, hasTime: false });
          }
        }}
        className="w-full min-w-[130px] border-none bg-transparent px-1 py-1 text-sm outline-none"
      />
    );
  }

  return (
    <div className="flex min-h-[26px] w-full items-center gap-1 rounded px-1 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex-1 truncate text-left text-sm"
      >
        {display ?? <span className="text-xs text-neutral-300 dark:text-neutral-600">Empty</span>}
      </button>
      {display && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Clear date"
          className="shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
