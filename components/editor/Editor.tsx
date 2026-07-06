"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import type { Node as PMNode } from "@tiptap/pm/model";
import clsx from "clsx";

import type { Block } from "@/lib/db/types";
import { saveBlocksAction } from "@/app/actions/editor";
import { blocksFromDoc, docFromBlocks } from "./blockSync";
import { Autocorrect } from "./extensions/autocorrect";
import { BlockId } from "./extensions/block-id";
import { Callout } from "./extensions/callout";
import { MoveBlock } from "./extensions/move-block";
import { Toggle, ToggleContent, ToggleSummary } from "./extensions/toggle";
import SlashMenu from "./SlashMenu";
import AIToolsMenu from "./AIToolsMenu";
import AIProposalCard from "./AIProposalCard";
import "./editor.css";

const SAVE_DEBOUNCE_MS = 1500;

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

export default function Editor({
  pageId,
  initialBlocks,
  breadcrumb,
}: {
  pageId: string;
  initialBlocks: Block[];
  breadcrumb?: string;
}) {
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const docRef = useRef<PMNode | null>(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build the initial doc once from the server-loaded rows.
  const initialDoc = useMemo(
    () => docFromBlocks(initialBlocks),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!dirtyRef.current || !docRef.current) return;
    dirtyRef.current = false;
    const blocks = blocksFromDoc(docRef.current);
    setSaveState("saving");
    saveBlocksAction(pageId, blocks)
      .then((result) => {
        // Newer edits arrived while saving: stay in "pending".
        if (dirtyRef.current) return;
        setSaveState(result.ok ? "saved" : "error");
      })
      .catch(() => {
        dirtyRef.current = true;
        setSaveState("error");
      });
  }, [pageId]);

  const scheduleSave = useCallback(
    (doc: PMNode) => {
      docRef.current = doc;
      dirtyRef.current = true;
      setSaveState("pending");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  // Flush pending changes on unmount and (best-effort) on tab close.
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      TaskList,
      TaskItem.configure({ nested: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Image,
      Callout,
      Toggle,
      ToggleSummary,
      ToggleContent,
      BlockId,
      MoveBlock,
      Autocorrect,
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "toggleSummary"
            ? "Toggle title…"
            : "Type '/' for commands…",
      }),
    ],
    content: initialDoc,
    editorProps: {
      attributes: {
        class: "editor-prose focus:outline-none",
        "data-page-id": pageId,
      },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith("image/")
        );
        if (files.length === 0) return false;
        event.preventDefault();
        for (const file of files) {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("pageId", pageId);
          fetch("/api/files", { method: "POST", body: formData })
            .then((res) => {
              if (!res.ok) throw new Error(`Image upload failed (${res.status})`);
              return res.json() as Promise<{ id: string }>;
            })
            .then(({ id }) => {
              const { schema } = view.state;
              const node = schema.nodes.image.create({ src: `/api/files/${id}` });
              view.dispatch(view.state.tr.replaceSelectionWith(node));
            })
            .catch((err) => console.error("Image paste failed:", err));
        }
        return true;
      },
    },
    onUpdate: ({ editor: e }) => scheduleSave(e.state.doc),
  });

  const label =
    saveState === "pending" || saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "Saved"
        : saveState === "error"
          ? "Save failed — retrying on next edit"
          : "";

  return (
    <>
      <div className="relative">
        <div
          className={clsx(
            "pointer-events-none absolute -top-6 right-0 text-xs transition-opacity",
            saveState === "error"
              ? "text-red-500"
              : "text-neutral-400 dark:text-neutral-500",
            label ? "opacity-100" : "opacity-0"
          )}
          aria-live="polite"
        >
          {label}
        </div>
        <EditorContent editor={editor} />
        {editor && (
          <>
            <SlashMenu editor={editor} breadcrumb={breadcrumb} />
            <AIProposalCard editor={editor} />
          </>
        )}
      </div>
      {/*
        AIToolsMenu (Tiptap's BubbleMenu) always renders a placeholder <div>
        that tippy.js physically reparents to document.body outside React's
        tracking. If it shared a DOM parent with SlashMenu/AIProposalCard —
        elements that mount/unmount conditionally — React sometimes picks
        that reparented, no-longer-a-child node as an insertBefore anchor
        when those siblings toggle, throwing "Failed to execute
        'insertBefore' on 'Node': ... is not a child of this node." Keeping
        it outside the div above, in its own sibling slot, means React never
        needs that node as a reconciliation anchor for the toggling elements.
      */}
      {editor && <AIToolsMenu editor={editor} breadcrumb={breadcrumb} />}
    </>
  );
}
