"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { renamePageTitleAction } from "@/app/actions/editor";

/** Big editable page title, saved on blur / Enter. */
export default function TitleInput({
  pageId,
  initialTitle,
}: {
  pageId: string;
  initialTitle: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  const lastSavedRef = useRef(initialTitle);
  const router = useRouter();

  // Adopt server-provided title after refreshes / navigation.
  useEffect(() => {
    setTitle(initialTitle);
    lastSavedRef.current = initialTitle;
  }, [initialTitle, pageId]);

  const commit = async () => {
    const next = title.trim() || "Untitled";
    setTitle(next);
    if (next === lastSavedRef.current) return;
    lastSavedRef.current = next;
    await renamePageTitleAction(pageId, next);
    router.refresh();
  };

  return (
    <input
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setTitle(lastSavedRef.current);
          e.currentTarget.blur();
        }
      }}
      placeholder="Untitled"
      aria-label="Page title"
      className="w-full bg-transparent text-3xl font-bold outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-600"
    />
  );
}
