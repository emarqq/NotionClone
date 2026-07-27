import TiptapLink from "@tiptap/extension-link";

import { useLinkEditorStore } from "../linkEditorStore";

/**
 * The MIT Link mark (@tiptap/extension-link — not bundled by StarterKit 2.27)
 * with a Notion-style Mod-k shortcut that opens the LinkEditor popup instead
 * of the extension's own (nonexistent) default. Configure at registration:
 * `Link.configure({ openOnClick: true, autolink: true, linkOnPaste: true,
 * HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer', class:
 * 'editor-link' } })`.
 *
 * A method (not an arrow fn) so `this.editor` binds to the extension instance.
 */
export const Link = TiptapLink.extend({
  addKeyboardShortcuts() {
    return {
      "Mod-k": () => {
        useLinkEditorStore.getState().open(this.editor);
        return true;
      },
    };
  },
});
