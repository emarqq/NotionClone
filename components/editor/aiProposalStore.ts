"use client";

import { create } from "zustand";

export type AITool = "summarize" | "format" | "organize" | "rewrite" | "continue";

/**
 * A pending AI edit proposal: the range it will replace (or, for 'continue',
 * the point it will insert after), the text sent to the model, and a
 * doc-size snapshot used to detect a stale range if the user keeps editing
 * while the proposal streams.
 */
export interface ProposalRequest {
  tool: AITool;
  from: number;
  to: number;
  selectedText: string;
  instruction?: string;
  breadcrumb?: string;
  docSize: number;
}

interface AIProposalState {
  request: ProposalRequest | null;
  open: (request: ProposalRequest) => void;
  close: () => void;
}

/**
 * Shared trigger point for the two AI-edit entry points (the selection
 * BubbleMenu and the no-selection SlashMenu "Continue writing" item) and the
 * single proposal card that renders whichever one is active.
 */
export const useAIProposalStore = create<AIProposalState>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));
