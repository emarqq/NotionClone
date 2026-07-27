"use client";

import { useEffect, useRef, useState } from "react";
import type { DbValue } from "@/lib/db/types";

/** Borderless inline text editor; commits on blur/Enter, Escape reverts. */
export default function TextCell({
  value,
  onChange,
}: {
  value: DbValue;
  onChange: (next: DbValue) => void;
}) {
  const initial = typeof value === "string" ? value : "";
  const [text, setText] = useState(initial);
  const lastCommittedRef = useRef(initial);

  useEffect(() => {
    setText(initial);
    lastCommittedRef.current = initial;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = () => {
    if (text === lastCommittedRef.current) return;
    lastCommittedRef.current = text;
    onChange(text === "" ? null : text);
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
      placeholder="Empty"
      className="w-full min-w-[100px] border-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-600"
    />
  );
}
