"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChainedCommands, Editor } from "@tiptap/core";
import clsx from "clsx";
import { ArrowRightCircle, FileUp, Mic, type LucideIcon } from "lucide-react";

import { textBeforePosition } from "./aiContext";
import { useAIProposalStore } from "./aiProposalStore";
import { BLOCK_ITEMS } from "./blockItems";
import { useImportStore } from "./importStore";
import { runMarkdownImport } from "./markdownImport";
import { useRecordingStore } from "@/components/recording/recordingStore";

interface SlashItem {
  title: string;
  keywords: string;
  icon: LucideIcon;
  /** Regular block-insert items run a chain command over the deleted query range. */
  run?: (chain: ChainedCommands) => ChainedCommands;
  /** AI items instead trigger a proposal at the (already-deleted) query position. */
  ai?: (editor: Editor, position: number, breadcrumb?: string) => void;
  /**
   * Async side-effecting items (file pickers etc.) that insert their own
   * content. Run after the query range is deleted, like `ai`.
   */
  action?: (editor: Editor, breadcrumb?: string) => void;
}

const ITEMS: SlashItem[] = [
  ...BLOCK_ITEMS.map(({ title, keywords, icon, run }) => ({ title, keywords, icon, run })),
  {
    title: "Continue writing",
    keywords: "ai continue draft generate",
    icon: ArrowRightCircle,
    ai: (editor, position, breadcrumb) => {
      useAIProposalStore.getState().open({
        tool: "continue",
        from: position,
        to: position,
        selectedText: textBeforePosition(editor, position),
        breadcrumb,
        docSize: editor.state.doc.content.size,
      });
    },
  },
  {
    title: "Import Markdown file",
    keywords: "import markdown md file upload obsidian",
    icon: FileUp,
    // Inserts at the caret, replacing the now-empty line the command was typed
    // on (see insertBlocks in markdownImport.ts).
    action: (editor) => void runMarkdownImport(editor, "cursor"),
  },
  {
    title: "Record meeting",
    keywords: "record meeting audio transcript transcribe call interview mic",
    icon: Mic,
    // Only opens the recorder; capture itself is owned by RecordingBar in
    // AppShell, so it survives this menu unmounting and any later navigation.
    // The transcript always appends at the end of the page, never at the caret —
    // by the time it exists the caret is wherever the user has since typed.
    action: (_editor, breadcrumb) => {
      const { pageId } = useImportStore.getState();
      if (!pageId) return;
      useRecordingStore.getState().open({
        pageId,
        spaceSlug: window.location.pathname.split("/").filter(Boolean)[0] ?? "",
        pageTitle: breadcrumb || "Untitled",
      });
    },
  },
];

interface MenuState {
  from: number;
  to: number;
  query: string;
  left: number;
  top: number;
}

const SLASH_PATTERN = /(?:^|\s)\/([A-Za-z0-9-]{0,24}(?: [A-Za-z0-9-]{0,24})?)$/;

/** Floating '/' command menu: derives its state from editor transactions. */
export default function SlashMenu({
  editor,
  breadcrumb,
}: {
  editor: Editor;
  breadcrumb?: string;
}) {
  const [menu, setMenuState] = useState<MenuState | null>(null);
  const [selected, setSelected] = useState(0);
  const menuRef = useRef<MenuState | null>(null);
  const suppressedRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const setMenu = useCallback((next: MenuState | null) => {
    menuRef.current = next;
    setMenuState(next);
  }, []);

  const query = menu?.query.toLowerCase() ?? "";
  const filtered = ITEMS.filter(
    (item) =>
      item.title.toLowerCase().includes(query) ||
      item.keywords.includes(query)
  );

  // Track the editor: open on '/', follow the query, close when it breaks.
  useEffect(() => {
    const update = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      const { selection } = editor.state;
      const { $from, empty } = selection;
      const parent = $from.parent;

      let match: RegExpExecArray | null = null;
      if (empty && parent.isTextblock && !parent.type.spec.code) {
        const text = parent.textBetween(0, $from.parentOffset, "\0", "\0");
        match = SLASH_PATTERN.exec(text);
      }

      if (!match) {
        suppressedRef.current = false;
        setMenu(null);
        return;
      }
      if (suppressedRef.current) return;

      const prev = menuRef.current;
      // Only open on an actual edit; a bare selection change (e.g. clicking
      // into a line that happens to end with '/') never opens the menu.
      if (!prev && !transaction.docChanged) return;

      const q = match[1];
      const from = selection.from - q.length - 1;
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

  const apply = (item: SlashItem) => {
    if (!menu) return;
    const range = { from: menu.from, to: menu.to };
    setMenu(null);
    if (item.ai) {
      editor.chain().focus().deleteRange(range).run();
      item.ai(editor, range.from, breadcrumb);
      return;
    }
    if (item.action) {
      editor.chain().focus().deleteRange(range).run();
      item.action(editor, breadcrumb);
      return;
    }
    item.run?.(editor.chain().focus().deleteRange(range)).run();
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
      aria-label="Insert block"
    >
      {filtered.map((item, i) => {
        const Icon = item.icon;
        return (
          <button
            key={item.title}
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
            onClick={() => apply(item)}
          >
            <Icon
              size={16}
              className="shrink-0 text-neutral-500 dark:text-neutral-400"
            />
            <span>{item.title}</span>
          </button>
        );
      })}
    </div>
  );
}
