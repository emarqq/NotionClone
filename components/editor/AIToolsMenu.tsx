"use client";

import { useState } from "react";
import { BubbleMenu } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import clsx from "clsx";
import {
  ArrowRightCircle,
  ListTree,
  Sparkles,
  WandSparkles,
  Wand2,
} from "lucide-react";

import { useAIProposalStore } from "./aiProposalStore";
import type { AITool } from "./aiProposalStore";

interface ToolButton {
  tool: AITool;
  label: string;
  icon: typeof Wand2;
}

const TOOLS: ToolButton[] = [
  { tool: "summarize", label: "Summarize", icon: Sparkles },
  { tool: "format", label: "Format", icon: WandSparkles },
  { tool: "organize", label: "Organize", icon: ListTree },
  { tool: "continue", label: "Continue writing", icon: ArrowRightCircle },
];

/**
 * Floating selection menu (Tiptap BubbleMenu): Summarize / Format / Organize /
 * Rewrite… / Continue writing, all propose → diff → accept/reject via
 * AIProposalCard. Hidden while a proposal is already open so the two
 * floating panels never fight for the same selection.
 */
export default function AIToolsMenu({
  editor,
  breadcrumb,
}: {
  editor: Editor;
  breadcrumb?: string;
}) {
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const open = useAIProposalStore((s) => s.open);

  const reset = () => {
    setRewriteOpen(false);
    setInstruction("");
  };

  const triggerTool = (tool: AITool) => {
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, "\n\n", "\n");
    if (tool === "continue") {
      // Continue from the selected text; insert after it rather than replacing it.
      open({
        tool,
        from: to,
        to,
        selectedText,
        breadcrumb,
        docSize: editor.state.doc.content.size,
      });
    } else {
      open({
        tool,
        from,
        to,
        selectedText,
        breadcrumb,
        docSize: editor.state.doc.content.size,
      });
    }
    reset();
  };

  const submitRewrite = () => {
    const trimmed = instruction.trim();
    if (!trimmed) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, "\n\n", "\n");
    open({
      tool: "rewrite",
      from,
      to,
      selectedText,
      instruction: trimmed,
      breadcrumb,
      docSize: editor.state.doc.content.size,
    });
    reset();
  };

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, state }) =>
        e.isEditable &&
        !state.selection.empty &&
        !useAIProposalStore.getState().request
      }
      tippyOptions={{ duration: 100, placement: "top", onHidden: reset }}
    >
      <div
        className="flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        role="menu"
        aria-label="AI tools"
      >
        {!rewriteOpen ? (
          <>
            {TOOLS.map(({ tool, label, icon: Icon }) => (
              <button
                key={tool}
                type="button"
                title={label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => triggerTool(tool)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                <Icon size={14} className="shrink-0" />
                <span>{label}</span>
              </button>
            ))}
            <button
              type="button"
              title="Rewrite with a custom instruction"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setRewriteOpen(true)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <Wand2 size={14} className="shrink-0" />
              <span>Rewrite…</span>
            </button>
          </>
        ) : (
          <input
            autoFocus
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitRewrite();
              } else if (e.key === "Escape") {
                e.preventDefault();
                reset();
              }
            }}
            placeholder="Make this formal…"
            className={clsx(
              "w-64 rounded-md border-none bg-transparent px-2 py-1.5 text-sm outline-none",
              "text-neutral-800 placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
            )}
          />
        )}
      </div>
    </BubbleMenu>
  );
}
