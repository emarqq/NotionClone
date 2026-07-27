"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import clsx from "clsx";

import { DefaultPageIcon, PageIcon } from "@/lib/icons";

interface PageOption {
  id: string;
  title: string;
  spaceSlug: string;
  icon: string | null;
}

interface MenuState {
  /** Doc range covering the trigger + query, replaced on select. */
  from: number;
  to: number;
  query: string;
  left: number;
  top: number;
}

// `@foo` (no spaces) and `[[foo bar` (spaces allowed). The captured group is
// the query; the trigger length (1 vs 2) sets where the replaced range starts.
const AT_PATTERN = /(?:^|\s)@([^\s@]{0,50})$/;
const BRACKET_PATTERN = /(?:^|\s)\[\[([^\]\n]{0,50})$/;

const MAX_RESULTS = 8;

/**
 * Floating page-mention popup — a MentionMenu mirror of SlashMenu. Opens on
 * `@` or `[[`, follows the query, and inserts a `pageMention` atom on select.
 * The page list is fetched once from /api/pages (server-only DB stays on the
 * server) and cached in a ref.
 */
export default function MentionMenu({
  editor,
  pageId,
}: {
  editor: Editor;
  pageId: string;
}) {
  const [menu, setMenuState] = useState<MenuState | null>(null);
  const [selected, setSelected] = useState(0);
  const [pages, setPages] = useState<PageOption[] | null>(null);
  const menuRef = useRef<MenuState | null>(null);
  const suppressedRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const setMenu = useCallback((next: MenuState | null) => {
    menuRef.current = next;
    setMenuState(next);
  }, []);

  // Fetch the page list once.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/pages")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
      .then((body: { pages: PageOption[] }) => {
        if (!cancelled) setPages(body.pages ?? []);
      })
      .catch(() => {
        if (!cancelled) setPages([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const query = menu?.query.toLowerCase() ?? "";
  const filtered = (pages ?? [])
    .filter(
      (p) =>
        p.id !== pageId &&
        (p.title || "Untitled").toLowerCase().includes(query)
    )
    .slice(0, MAX_RESULTS);

  // Track the editor: open on '@' or '[[', follow the query, close on break.
  useEffect(() => {
    const update = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      const { selection } = editor.state;
      const { $from, empty } = selection;
      const parent = $from.parent;

      let match: RegExpExecArray | null = null;
      let triggerLen = 0;
      if (empty && parent.isTextblock && !parent.type.spec.code) {
        const text = parent.textBetween(0, $from.parentOffset, "\0", "\0");
        const bracket = BRACKET_PATTERN.exec(text);
        if (bracket) {
          match = bracket;
          triggerLen = 2;
        } else {
          const at = AT_PATTERN.exec(text);
          if (at) {
            match = at;
            triggerLen = 1;
          }
        }
      }

      if (!match) {
        suppressedRef.current = false;
        setMenu(null);
        return;
      }
      if (suppressedRef.current) return;

      const prev = menuRef.current;
      // Only open on an actual edit; a bare selection change never opens it.
      if (!prev && !transaction.docChanged) return;

      const q = match[1];
      const from = selection.from - q.length - triggerLen;
      const coords = editor.view.coordsAtPos(from);
      if (!prev || prev.query !== q) setSelected(0);
      setMenu({
        from,
        to: selection.from,
        query: q,
        left: Math.min(coords.left, window.innerWidth - 280),
        top: Math.min(coords.bottom + 6, window.innerHeight - 340),
      });
    };
    const close = () => setMenu(null);
    editor.on("transaction", update);
    editor.on("blur", close);
    return () => {
      editor.off("transaction", update);
      editor.off("blur", close);
    };
  }, [editor, setMenu]);

  const apply = (page: PageOption) => {
    if (!menu) return;
    const range = { from: menu.from, to: menu.to };
    setMenu(null);
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .insertContent([
        {
          type: "pageMention",
          attrs: {
            pageId: page.id,
            label: page.title || "Untitled",
            spaceSlug: page.spaceSlug,
          },
        },
        { type: "text", text: " " },
      ])
      .run();
  };

  // Capture-phase keyboard handling so ProseMirror never sees these keys.
  useEffect(() => {
    if (!menu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        suppressedRef.current = true;
        setMenu(null);
        return;
      }
      if (filtered.length === 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setSelected((s) => (s + delta + filtered.length) % filtered.length);
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        apply(filtered[Math.min(selected, filtered.length - 1)]);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  });

  // Keep the highlighted row visible.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, menu?.query]);

  if (!menu || filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="fixed z-50 max-h-80 w-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      style={{ left: menu.left, top: menu.top }}
      role="listbox"
      aria-label="Link to page"
    >
      {filtered.map((page, i) => (
        <button
          key={page.id}
          type="button"
          role="option"
          aria-selected={i === selected}
          data-selected={i === selected}
          className={clsx(
            "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm",
            i === selected
              ? "bg-secondary/10 dark:bg-secondary/15"
              : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
          )}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setSelected(i)}
          onClick={() => apply(page)}
        >
          <span className="flex w-4 shrink-0 items-center justify-center text-neutral-500 dark:text-neutral-400">
            <PageIcon icon={page.icon} size={16} fallback={<DefaultPageIcon size={16} />} />
          </span>
          <span className="min-w-0 flex-1 truncate">{page.title || "Untitled"}</span>
        </button>
      ))}
    </div>
  );
}
