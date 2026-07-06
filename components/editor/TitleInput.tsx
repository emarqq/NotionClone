"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Adopt server-provided title after refreshes / navigation.
  useEffect(() => {
    setTitle(initialTitle);
    lastSavedRef.current = initialTitle;
  }, [initialTitle, pageId]);

  // Newly created pages navigate here with ?focusTitle=1 — jump straight
  // into the title, selected, so typing replaces the "New page" default.
  useEffect(() => {
    if (searchParams.get("focusTitle") !== "1") return;
    inputRef.current?.focus();
    inputRef.current?.select();
    router.replace(pathname, { scroll: false });
  }, [pathname, searchParams, router]);

  const commit = async () => {
    const next = title.trim() || "Untitled";
    setTitle(next);
    if (next === lastSavedRef.current) return;
    lastSavedRef.current = next;
    await renamePageTitleAction(pageId, next);
    router.refresh();
  };

  // Move focus into the first block of the editor, cursor at the start.
  const focusEditor = () => {
    const el = document.querySelector<HTMLElement>(
      `[data-page-id="${pageId}"]`
    );
    el?.focus();
  };

  return (
    <input
      ref={inputRef}
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
          e.preventDefault();
          e.currentTarget.blur();
          focusEditor();
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
