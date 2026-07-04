import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";

/** Absolute doc position where top-level child `index` starts. */
function topLevelStart(editor: Editor, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) {
    pos += editor.state.doc.child(i).nodeSize;
  }
  return pos;
}

function moveTopLevelBlock(editor: Editor, direction: -1 | 1): boolean {
  const { state } = editor;
  const { selection, doc } = state;
  const index = selection.$from.index(0);
  const target = index + direction;
  if (target < 0 || target >= doc.childCount) return false;

  const node = doc.child(index);
  const other = doc.child(target);
  const start = topLevelStart(editor, index);
  const selOffset = selection.from - start;

  const tr = state.tr;
  tr.delete(start, start + node.nodeSize);
  const insertAt =
    direction === -1 ? start - other.nodeSize : start + other.nodeSize;
  tr.insert(insertAt, node);

  const anchor = insertAt + selOffset;
  try {
    if (selection instanceof NodeSelection) {
      tr.setSelection(NodeSelection.create(tr.doc, insertAt));
    } else {
      tr.setSelection(TextSelection.create(tr.doc, anchor));
    }
  } catch {
    tr.setSelection(Selection.near(tr.doc.resolve(insertAt), 1));
  }
  tr.scrollIntoView();
  editor.view.dispatch(tr);
  return true;
}

/** Alt+ArrowUp / Alt+ArrowDown move the current top-level block. */
export const MoveBlock = Extension.create({
  name: "moveBlock",

  addKeyboardShortcuts() {
    return {
      "Alt-ArrowUp": ({ editor }) => moveTopLevelBlock(editor, -1),
      "Alt-ArrowDown": ({ editor }) => moveTopLevelBlock(editor, 1),
    };
  },
});
