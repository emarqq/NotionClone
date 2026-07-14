"use client";

import type { DbValue } from "@/lib/db/types";

/** Native checkbox, centered, toggles immediately. */
export default function CheckboxCell({
  value,
  onChange,
}: {
  value: DbValue;
  onChange: (next: DbValue) => void;
}) {
  const checked = value === true;
  return (
    <div className="flex justify-center">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label="Toggle"
        className="h-4 w-4 cursor-pointer accent-blue-600 dark:accent-blue-500"
      />
    </div>
  );
}
