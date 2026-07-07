import { Mark, mergeAttributes } from "@tiptap/core";

import { useCommentStore } from "../commentStore";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comment: {
      /** Applies a comment mark carrying `threadId` to the current selection. */
      setComment: (threadId: string) => ReturnType;
      /** Removes every comment mark for `threadId` across the whole document. */
      unsetComment: (threadId: string) => ReturnType;
    };
  }
}

/**
 * Comment: an inline mark that anchors a comment thread to a text range. It
 * carries only a `threadId` (round-tripping through `data-comment-thread`); the
 * thread's messages and resolve state live in Postgres, keyed by that id.
 * Because it's a mark, ProseMirror re-anchors it with the text automatically as
 * the document is edited — no offset bookkeeping. Mirrors the Link mark, and
 * round-trips through the block-save pipeline for free (node.toJSON()).
 *
 * Limitation: two comments on the exact same span aren't supported (a single
 * mark type; setMark on the overlap replaces the threadId). Distinct/adjacent
 * ranges are fine.
 */
export const Comment = Mark.create({
  name: "comment",
  // Typing at either edge of a comment must not extend it into new text.
  inclusive: false,

  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-comment-thread"),
        renderHTML: (attributes) =>
          attributes.threadId
            ? { "data-comment-thread": attributes.threadId }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-comment-thread]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "editor-comment" }),
      0,
    ];
  },

  addCommands() {
    return {
      setComment:
        (threadId) =>
        ({ commands }) =>
          commands.setMark(this.name, { threadId }),

      // Remove the mark everywhere it carries this threadId (used on
      // resolve/delete). removeMark is size-preserving, so positions taken from
      // the current doc stay valid across the accumulated steps.
      unsetComment:
        (threadId) =>
        ({ state, tr, dispatch }) => {
          const markType = state.schema.marks.comment;
          if (!markType) return false;
          let changed = false;
          state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            const hit = node.marks.some(
              (m) => m.type === markType && m.attrs.threadId === threadId
            );
            if (hit) {
              tr.removeMark(pos, pos + node.nodeSize, markType);
              changed = true;
            }
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-m": () => {
        const { editor } = this;
        if (editor.state.selection.empty) return false;
        useCommentStore.getState().openComposer(editor);
        return true;
      },
    };
  },
});
