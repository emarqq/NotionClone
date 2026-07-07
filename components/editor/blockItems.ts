import type { ChainedCommands, Editor } from "@tiptap/core";
import {
  ChevronRight,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Lightbulb,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Table,
  Type,
  type LucideIcon,
} from "lucide-react";

export interface BlockItem {
  id: string;
  title: string;
  keywords: string;
  icon: LucideIcon;
  run: (chain: ChainedCommands) => ChainedCommands;
  isActive: (editor: Editor) => boolean;
  /** False for block types that replace rather than convert a selection (e.g. Table, Divider). */
  turnInto?: boolean;
}

/** Shared block-type catalog: SlashMenu inserts these, AIToolsMenu's "Turn into" converts to them. */
export const BLOCK_ITEMS: BlockItem[] = [
  {
    id: "text",
    title: "Text",
    keywords: "paragraph plain",
    icon: Type,
    run: (c) => c.setParagraph(),
    isActive: (e) => e.isActive("paragraph"),
  },
  {
    id: "h1",
    title: "Heading 1",
    keywords: "h1 title",
    icon: Heading1,
    run: (c) => c.setHeading({ level: 1 }),
    isActive: (e) => e.isActive("heading", { level: 1 }),
  },
  {
    id: "h2",
    title: "Heading 2",
    keywords: "h2 subtitle",
    icon: Heading2,
    run: (c) => c.setHeading({ level: 2 }),
    isActive: (e) => e.isActive("heading", { level: 2 }),
  },
  {
    id: "h3",
    title: "Heading 3",
    keywords: "h3",
    icon: Heading3,
    run: (c) => c.setHeading({ level: 3 }),
    isActive: (e) => e.isActive("heading", { level: 3 }),
  },
  {
    id: "h4",
    title: "Heading 4",
    keywords: "h4",
    icon: Heading4,
    run: (c) => c.setHeading({ level: 4 }),
    isActive: (e) => e.isActive("heading", { level: 4 }),
  },
  {
    id: "bullet",
    title: "Bulleted list",
    keywords: "unordered ul bullet",
    icon: List,
    run: (c) => c.toggleBulletList(),
    isActive: (e) => e.isActive("bulletList"),
  },
  {
    id: "numbered",
    title: "Numbered list",
    keywords: "ordered ol",
    icon: ListOrdered,
    run: (c) => c.toggleOrderedList(),
    isActive: (e) => e.isActive("orderedList"),
  },
  {
    id: "todo",
    title: "To-do list",
    keywords: "task checkbox checklist",
    icon: ListChecks,
    run: (c) => c.toggleTaskList(),
    isActive: (e) => e.isActive("taskList"),
  },
  {
    id: "table",
    title: "Table",
    keywords: "grid rows columns",
    icon: Table,
    run: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
    isActive: (e) => e.isActive("table"),
    turnInto: false,
  },
  {
    id: "quote",
    title: "Quote",
    keywords: "blockquote citation",
    icon: Quote,
    run: (c) => c.toggleBlockquote(),
    isActive: (e) => e.isActive("blockquote"),
  },
  {
    id: "code",
    title: "Code block",
    keywords: "codeblock snippet",
    icon: Code,
    run: (c) => c.toggleCodeBlock(),
    isActive: (e) => e.isActive("codeBlock"),
  },
  {
    id: "callout",
    title: "Callout",
    keywords: "info note box emoji",
    icon: Lightbulb,
    run: (c) => c.insertCallout(),
    isActive: (e) => e.isActive("callout"),
  },
  {
    id: "toggle",
    title: "Toggle",
    keywords: "collapse details expand",
    icon: ChevronRight,
    run: (c) => c.insertToggle(),
    isActive: (e) => e.isActive("toggle"),
  },
  {
    id: "divider",
    title: "Divider",
    keywords: "horizontal rule separator hr",
    icon: Minus,
    run: (c) => c.setHorizontalRule(),
    isActive: () => false,
    turnInto: false,
  },
];

/** Most-nested-first so a paragraph inside a Callout reports "Callout", not "Text". */
const DETECTION_ORDER = [
  "callout",
  "toggle",
  "h4",
  "h3",
  "h2",
  "h1",
  "quote",
  "code",
  "todo",
  "bullet",
  "numbered",
  "table",
];

export function getCurrentBlockItem(editor: Editor): BlockItem {
  const byId = new Map(BLOCK_ITEMS.map((item) => [item.id, item]));
  for (const id of DETECTION_ORDER) {
    const item = byId.get(id);
    if (item?.isActive(editor)) return item;
  }
  return byId.get("text")!;
}
