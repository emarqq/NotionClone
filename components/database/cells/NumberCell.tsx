"use client";

import { useEffect, useRef, useState } from "react";
import type { DbValue } from "@/lib/db/types";

function formatValue(value: DbValue): string {
  return typeof value === "number" ? String(value) : "";
}

/** Borderless inline number editor, right-aligned; invalid input reverts. */
export default function NumberCell({
  value,
  onChange,
}: {
  value: DbValue;
  onChange: (next: DbValue) => void;
}) {
  const [text, setText] = useState(() => formatValue(value));
  const lastCommittedRef = useRef(formatValue(value));

  useEffect(() => {
    const next = formatValue(value);
    setText(next);
    lastCommittedRef.current = next;
  }, [value]);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === "") {
      setText("");
      if (lastCommittedRef.current === "") return;
      lastCommittedRef.current = "";
      onChange(null);
      return;
    }
    const parsed = parseFloat(trimmed);
    if (Number.isNaN(parsed)) {
      setText(lastCommittedRef.current);
      return;
    }
    const normalized = String(parsed);
    setText(normalized);
    if (normalized === lastCommittedRef.current) return;
    lastCommittedRef.current = normalized;
    onChange(parsed);
  };

  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setText(lastCommittedRef.current);
          e.currentTarget.blur();
        }
      }}
      inputMode="decimal"
      placeholder="Empty"
      className="w-full min-w-[80px] border-none bg-transparent px-1 py-1 text-right text-sm outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-600"
    />
  );
}
