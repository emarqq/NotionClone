"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";

import { useLinkEditorStore } from "./linkEditorStore";

/**
 * Normalizes typed input into an href: internal page paths ("/slug/id") and
 * strings that already carry a scheme (http:, mailto:, …) pass through; a
 * bare "example.com" gets an https:// prefix. Empty → "" (signals unlink).
 */
function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

interface Position {
  left: number;
  top: number;
}

/**
 * SlashMenu-style fixed-position popup with a single URL input, driven by
 * useLinkEditorStore. Positioned at the selection via coordsAtPos (clamped to
 * the viewport). Enter applies (or unsets on empty input); Escape closes.
 */
export default function LinkEditor({ editor }: { editor: Editor }) {
  const target = useLinkEditorStore((s) => s.target);
  const close = useLinkEditorStore((s) => s.close);
  const [value, setValue] = useState("");
  const [pos, setPos] = useState<Position | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // When a target opens, seed the input, position the popup at the selection
  // start, and focus/select the field.
  useEffect(() => {
    if (!target) {
      setPos(null);
      return;
    }
    setValue(target.initialHref);
    try {
      const coords = editor.view.coordsAtPos(target.from);
      setPos({
        left: Math.min(coords.left, window.innerWidth - 340),
        top: Math.min(coords.bottom + 6, window.innerHeight - 80),
      });
    } catch {
      setPos({ left: 16, top: 80 });
    }
    // Focus after paint so the input exists.
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [target, editor]);

  if (!target || !pos) return null;

  const apply = () => {
    const href = normalizeUrl(value);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (href) chain.setLink({ href }).run();
    else chain.unsetLink().run();
    close();
  };

  return (
    <div
      className="fixed z-50 flex w-80 items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      style={{ left: pos.left, top: pos.top }}
      role="dialog"
      aria-label="Edit link"
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
            editor.chain().focus().run();
          }
        }}
        // Closing on blur lets a click outside dismiss the popup; the Enter/
        // Escape handlers above run first, so applying still works.
        onBlur={() => close()}
        placeholder="Paste a link or type a URL…"
        className="w-full rounded-md border-none bg-transparent px-2 py-1 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
      />
    </div>
  );
}
