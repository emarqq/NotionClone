import { Extension } from "@tiptap/core";

/**
 * Backspace at the very start of an *empty* list item lifts it out of the list
 * into a normal paragraph — the Notion behavior. StarterKit's `ListItem` binds
 * no Backspace and `@tiptap/extension-list-keymap` isn't installed, so the PM
 * base keymap's `joinBackward` otherwise merges the empty item back into the
 * previous bullet (the bullet "persists" and Enter re-splits a new one).
 *
 * We only handle the empty-first-child case and defer to the default keymap
 * (`return false`) everywhere else, so normal character deletion and joins are
 * untouched. Nested items outdent one level at a time via `liftListItem`
 * (mirroring Shift-Tab). Bound to Backspace only — Delete's forward-delete
 * semantics (pull the next block up) are intentionally left to the default.
 */
export const ListExit = Extension.create({
  name: "listExit",

  // Above the core `keymap` extension (default priority 100) so our Backspace
  // is tried before its `joinBackward`, which would otherwise merge the empty
  // item into the previous bullet instead of lifting it.
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        // Collapsed caret at the start of an empty textblock…
        if (!empty || $from.parentOffset !== 0 || $from.parent.content.size !== 0) {
          return false;
        }
        // …that is the first child of a list item (bullet/ordered or a task).
        const container = $from.node(-1);
        if (!container || $from.index(-1) !== 0) return false;
        const typeName = container.type.name;
        if (typeName !== "listItem" && typeName !== "taskItem") return false;

        // liftListItem returns false if it can't lift, letting the default
        // Backspace chain run — so this never traps the key.
        return editor.commands.liftListItem(typeName);
      },
    };
  },
});
