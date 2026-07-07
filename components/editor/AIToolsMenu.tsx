"use client";

import { useEffect, useRef, useState } from "react";
import { BubbleMenu } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import clsx from "clsx";
import {
  ArrowRightCircle,
  Bold,
  Check,
  ChevronLeft,
  ChevronRight,
  Code,
  Eraser,
  Italic,
  Link2,
  ListTree,
  MessageSquare,
  Sparkles,
  Strikethrough,
  Underline as UnderlineIcon,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

import { useAIProposalStore } from "./aiProposalStore";
import type { AITool } from "./aiProposalStore";
import { useLinkEditorStore } from "./linkEditorStore";
import { BLOCK_ITEMS, getCurrentBlockItem } from "./blockItems";

interface ToolButton {
  tool: AITool;
  label: string;
  icon: LucideIcon;
}

const TOOLS: ToolButton[] = [
  { tool: "summarize", label: "Summarize", icon: Sparkles },
  { tool: "format", label: "Format", icon: WandSparkles },
  { tool: "organize", label: "Organize", icon: ListTree },
  { tool: "continue", label: "Continue writing", icon: ArrowRightCircle },
];

interface MarkButton {
  mark: string;
  label: string;
  icon: LucideIcon;
  toggle: (editor: Editor) => void;
}

const MARK_BUTTONS: MarkButton[] = [
  { mark: "bold", label: "Bold", icon: Bold, toggle: (e) => e.chain().focus().toggleBold().run() },
  { mark: "italic", label: "Italic", icon: Italic, toggle: (e) => e.chain().focus().toggleItalic().run() },
  { mark: "underline", label: "Underline", icon: UnderlineIcon, toggle: (e) => e.chain().focus().toggleUnderline().run() },
  { mark: "strike", label: "Strikethrough", icon: Strikethrough, toggle: (e) => e.chain().focus().toggleStrike().run() },
  { mark: "code", label: "Inline code", icon: Code, toggle: (e) => e.chain().focus().toggleCode().run() },
];

const HIGHLIGHT_COLORS: { label: string; color: string }[] = [
  { label: "Yellow", color: "#fef08a" },
  { label: "Green", color: "#bbf7d0" },
  { label: "Blue", color: "#bfdbfe" },
  { label: "Pink", color: "#fbcfe8" },
];

// Table/Divider replace a selection rather than converting it, so they stay
// SlashMenu-only inserts and don't appear as "Turn into" targets.
const TURN_INTO_ITEMS = BLOCK_ITEMS.filter((item) => item.turnInto !== false);

const TURN_INTO_HOVER_DELAY_MS = 400;

const rowClass =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800";

const markButtonClass = (active: boolean) =>
  clsx(
    "flex shrink-0 items-center justify-center rounded-md p-1.5",
    active
      ? "bg-secondary/15 text-secondary"
      : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
  );

/**
 * Floating selection menu (Tiptap BubbleMenu): turn-into block conversion
 * (reuses the SlashMenu's block catalog), word formatting, a Comment
 * placeholder (backend not built yet), and AI tools — all AI actions
 * propose → diff → accept/reject via AIProposalCard. Hidden while a
 * proposal is already open so the two floating panels never fight for the
 * same selection.
 */
export default function AIToolsMenu({
  editor,
  breadcrumb,
}: {
  editor: Editor;
  breadcrumb?: string;
}) {
  const [view, setView] = useState<"main" | "turnInto">("main");
  const [instruction, setInstruction] = useState("");
  const open = useAIProposalStore((s) => s.open);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoverTimer = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };
  useEffect(() => clearHoverTimer, []);

  const scheduleTurnIntoOpen = () => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => setView("turnInto"), TURN_INTO_HOVER_DELAY_MS);
  };

  const reset = () => {
    clearHoverTimer();
    setView("main");
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

  const currentBlock = getCurrentBlockItem(editor);
  const CurrentIcon = currentBlock.icon;

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, state }) =>
        e.isEditable &&
        !state.selection.empty &&
        !useAIProposalStore.getState().request
      }
      tippyOptions={{ duration: 100, placement: "bottom-start", maxWidth: "none", onHidden: reset }}
    >
      <div
        className="w-64 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        role="menu"
        aria-label="Selection tools"
      >
        {view === "turnInto" ? (
          <div className="max-h-80 overflow-y-auto p-1">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setView("main")}
              className={clsx(rowClass, "mb-1 font-medium text-neutral-500 dark:text-neutral-400")}
            >
              <ChevronLeft size={14} className="shrink-0" />
              Turn into
            </button>
            {TURN_INTO_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = item.id === currentBlock.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    item.run(editor.chain().focus()).run();
                    setView("main");
                  }}
                  className={rowClass}
                >
                  <Icon size={15} className="shrink-0 text-neutral-500 dark:text-neutral-400" />
                  <span className="flex-1">{item.title}</span>
                  {active && (
                    <Check size={14} className="shrink-0 text-neutral-500 dark:text-neutral-400" />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="p-1">
            {/* Turn into */}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setView("turnInto")}
              onMouseEnter={scheduleTurnIntoOpen}
              onMouseLeave={clearHoverTimer}
              className={rowClass}
            >
              <CurrentIcon size={15} className="shrink-0 text-neutral-500 dark:text-neutral-400" />
              <span className="flex-1">{currentBlock.title}</span>
              <ChevronRight size={14} className="shrink-0 text-neutral-400" />
            </button>

            <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-700" />

            {/* Word formatting */}
            <div className="flex items-center gap-0.5 px-1 py-1">
              {MARK_BUTTONS.map(({ mark, label, icon: Icon, toggle }) => (
                <button
                  key={mark}
                  type="button"
                  title={label}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggle(editor)}
                  className={markButtonClass(editor.isActive(mark))}
                >
                  <Icon size={14} className="shrink-0" />
                </button>
              ))}
              <button
                type="button"
                title="Link (⌘K)"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => useLinkEditorStore.getState().open(editor)}
                className={markButtonClass(editor.isActive("link"))}
              >
                <Link2 size={14} className="shrink-0" />
              </button>
              <button
                type="button"
                title="Clear formatting"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().unsetAllMarks().run()}
                className={markButtonClass(false)}
              >
                <Eraser size={14} className="shrink-0" />
              </button>
            </div>
            <div className="flex items-center gap-1.5 px-2 pb-1">
              {HIGHLIGHT_COLORS.map(({ label, color }) => (
                <button
                  key={color}
                  type="button"
                  title={`Highlight: ${label}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => editor.chain().focus().toggleHighlight({ color }).run()}
                  className={clsx(
                    "size-4 shrink-0 rounded-full border border-neutral-300 dark:border-neutral-600",
                    editor.isActive("highlight", { color }) &&
                      "ring-2 ring-offset-1 ring-neutral-500 dark:ring-offset-neutral-900"
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>

            <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-700" />

            {/* Comment — anchoring/threads/resolve not built yet */}
            <button
              type="button"
              disabled
              title="Comments are coming soon"
              className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-400 dark:text-neutral-500"
            >
              <MessageSquare size={15} className="shrink-0" />
              <span className="flex-1">Comment</span>
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800">
                Soon
              </span>
            </button>

            <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-700" />

            {/* AI tools */}
            <div className="px-2 pb-1 pt-0.5 text-xs font-medium text-neutral-400 dark:text-neutral-500">
              AI tools
            </div>
            {TOOLS.map(({ tool, label, icon: Icon }) => (
              <button
                key={tool}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => triggerTool(tool)}
                className={rowClass}
              >
                <Icon size={15} className="shrink-0 text-neutral-500 dark:text-neutral-400" />
                <span>{label}</span>
              </button>
            ))}

            <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-700" />

            <input
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
              placeholder="Edit with AI…"
              className={clsx(
                "w-full rounded-md border-none bg-transparent px-2 py-1.5 text-sm outline-none",
                "text-neutral-800 placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
              )}
            />
          </div>
        )}
      </div>
    </BubbleMenu>
  );
}
