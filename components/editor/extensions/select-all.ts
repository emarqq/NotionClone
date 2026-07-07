import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { AllSelection } from "@tiptap/pm/state";

function selectAllDoc(editor: Editor): boolean {
  const { state, view } = editor;
  const tr = state.tr.setSelection(new AllSelection(state.doc));
  view.dispatch(tr);
  return true;
}

/** Mod-a selects the entire editor document, not the surrounding page chrome. */
export const SelectAll = Extension.create({
  name: "selectAll",

  addKeyboardShortcuts() {
    return {
      "Mod-a": ({ editor }) => selectAllDoc(editor),
    };
  },
});
