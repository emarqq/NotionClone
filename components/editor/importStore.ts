"use client";

import type { Editor } from "@tiptap/core";
import { create } from "zustand";

import type { ImportOutcome } from "./markdownImport";

export type ImportStatus =
  | { kind: "importing"; fileName: string }
  | { kind: "done"; outcome: ImportOutcome }
  | { kind: "error"; message: string };

interface ImportState {
  /**
   * The mounted page editor, plus WHICH page it is editing.
   *
   * The pageId is not redundant: PageActionsMenu also renders on sidebar rows
   * for pages that are not open, so its import item must be able to tell "this
   * menu belongs to the page in the editor" from "this menu belongs to some
   * other page". Without that check, importing from a sidebar row would dump
   * the file into whatever page happened to be open. Mirrors the
   * nullable-target shape of linkEditorStore/aiProposalStore.
   */
  editor: Editor | null;
  pageId: string | null;
  status: ImportStatus | null;
  register: (editor: Editor, pageId: string) => void;
  unregister: (pageId: string) => void;
  setStatus: (status: ImportStatus | null) => void;
}

export const useImportStore = create<ImportState>((set) => ({
  editor: null,
  pageId: null,
  status: null,
  register: (editor, pageId) => set({ editor, pageId }),
  unregister: (pageId) =>
    // Only clear if this page is still the registered one. React mounts the
    // next Editor before running the previous one's cleanup, so an
    // unconditional clear would wipe the incoming registration on navigation.
    set((s) => (s.pageId === pageId ? { editor: null, pageId: null, status: null } : s)),
  setStatus: (status) => set({ status }),
}));
