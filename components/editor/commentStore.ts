"use client";

import type { Editor } from "@tiptap/core";
import { create } from "zustand";

/**
 * The text range a new comment will anchor to, snapshotted when the composer
 * opens (the live selection may change while the composer is focused). Mirrors
 * linkEditorStore's nullable-target shape.
 */
export interface ComposerTarget {
  editor: Editor;
  from: number;
  to: number;
  text: string;
}

interface CommentStoreState {
  /** Active "add comment" composer, or null. */
  composer: ComposerTarget | null;
  /** Thread whose read/reply popover is open, or null. */
  openThreadId: string | null;
  /** Whether the side threads panel is expanded. */
  panelOpen: boolean;
  /** Bumped after every mutation so the panel + popover refetch. */
  refreshKey: number;
  openComposer: (editor: Editor, range?: { from: number; to: number }) => void;
  closeComposer: () => void;
  openThread: (threadId: string) => void;
  closeThread: () => void;
  togglePanel: () => void;
  refresh: () => void;
}

/**
 * Shared coordinator for the comment UI: the add-comment composer (opened from
 * the bubble-menu button, ⌘⇧M, or the gutter icon), the read/reply popover
 * (opened by clicking a highlight or a panel row), and the side panel. `refresh`
 * bumps a counter that the panel + popover key their fetches on.
 */
export const useCommentStore = create<CommentStoreState>((set) => ({
  composer: null,
  openThreadId: null,
  panelOpen: false,
  refreshKey: 0,
  openComposer: (editor, range) => {
    const { from, to } = range ?? editor.state.selection;
    if (from === to) return; // nothing selected → nothing to anchor to
    const text = editor.state.doc.textBetween(from, to, " ");
    set({ composer: { editor, from, to, text }, openThreadId: null });
  },
  closeComposer: () => set({ composer: null }),
  openThread: (threadId) => set({ openThreadId: threadId, composer: null }),
  closeThread: () => set({ openThreadId: null }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  refresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
}));
