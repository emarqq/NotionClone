import { mergeAttributes, Node } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** Inserts a callout box at the current selection. */
      insertCallout: (attrs?: { emoji?: string }) => ReturnType;
    };
  }
}

/**
 * Callout: a tinted rounded box with a leading emoji and rich block content.
 * Attrs: { emoji: string } (default 💡).
 */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      emoji: {
        default: "💡",
        parseHTML: (element) => element.getAttribute("data-emoji") ?? "💡",
        renderHTML: (attributes) => ({ "data-emoji": attributes.emoji }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "callout",
        class: "callout",
      }),
      [
        "span",
        { class: "callout-emoji", contenteditable: "false" },
        String(node.attrs.emoji ?? "💡"),
      ],
      ["div", { class: "callout-content" }, 0],
    ];
  },

  addCommands() {
    return {
      insertCallout:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { emoji: attrs.emoji ?? "💡" },
            content: [{ type: "paragraph" }],
          }),
    };
  },
});
