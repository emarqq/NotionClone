/**
 * The editor's extension list — the single definition of the document schema.
 *
 * Extracted from Editor.tsx so it can be loaded without React: `getSchema(
 * EDITOR_EXTENSIONS)` gives the exact ProseMirror schema the running editor
 * uses, which lets tests assert that generated content (notably the Markdown
 * importer's output, lib/import/markdownToDoc.ts) is actually legal. A schema
 * copy maintained inside a test would drift from this list and quietly stop
 * proving anything — an invalid node breaks the page's whole batched save.
 *
 * No "use client" and no React/CSS imports here on purpose: every extension in
 * the list is pure (no node views), so this module stays Node-importable.
 * Anything React-flavored belongs in Editor.tsx, not here.
 */

import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";

import { Autocorrect } from "./extensions/autocorrect";
import { AutoCapitalize } from "./extensions/auto-capitalize";
import { BlockId } from "./extensions/block-id";
import { Callout } from "./extensions/callout";
import { Comment } from "./extensions/comment";
import { Link } from "./extensions/link";
import { ListExit } from "./extensions/list-exit";
import { DragHandle } from "./extensions/drag-handle";
import { MoveBlock } from "./extensions/move-block";
import { PageMention } from "./extensions/page-mention";
import { SelectAll } from "./extensions/select-all";
import { Toggle, ToggleContent, ToggleSummary } from "./extensions/toggle";

export const EDITOR_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4] },
  }),
  TaskList,
  TaskItem.configure({ nested: false }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  Image,
  Underline,
  Highlight.configure({ multicolor: true }),
  Link.configure({
    openOnClick: true,
    autolink: true,
    linkOnPaste: true,
    HTMLAttributes: {
      target: "_blank",
      rel: "noopener noreferrer",
      class: "editor-link",
    },
  }),
  Callout,
  Comment,
  Toggle,
  ToggleSummary,
  ToggleContent,
  PageMention,
  BlockId,
  ListExit,
  MoveBlock,
  DragHandle,
  SelectAll,
  Autocorrect,
  AutoCapitalize,
  Placeholder.configure({
    placeholder: ({ node }) =>
      node.type.name === "toggleSummary" ? "Toggle title…" : "Type '/' for commands…",
  }),
];
