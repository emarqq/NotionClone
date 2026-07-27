"use client";

import type { Editor } from "@tiptap/core";
import { create } from "zustand";

/**
 * The active link-editing target: the editor plus the selection snapshot the
 * popup will apply a link to, and the href already on that selection (empty
 * for a fresh link). Mirrors aiProposalStore.ts's nullable-request shape.
 */
export interface LinkTarget {
  editor: Editor;
  from: number;
  to: number;
  initialHref: string;
}

interface LinkEditorState {
  target: LinkTarget | null;
  open: (editor: Editor) => void;
  close: () => void;
}

/**
 * Shared trigger for the two link entry points — the selection BubbleMenu's
 * "Link" button and the editor's Mod-k shortcut — and the single LinkEditor
 * popup that renders whichever selection is active. `open` snapshots the
 * current selection and any existing link href off the editor.
 */
export const useLinkEditorStore = create<LinkEditorState>((set) => ({
  target: null,
  open: (editor) => {
    const { from, to } = editor.state.selection;
    const initialHref = (editor.getAttributes("link").href as string) ?? "";
    set({ target: { editor, from, to, initialHref } });
  },
  close: () => set({ target: null }),
}));
