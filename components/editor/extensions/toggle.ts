import { mergeAttributes, Node } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    toggle: {
      /** Inserts a collapsible toggle block at the current selection. */
      insertToggle: () => ReturnType;
    };
  }
}

const CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

/** Inline-text summary line of a toggle. */
export const ToggleSummary = Node.create({
  name: "toggleSummary",
  content: "inline*",
  isolating: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'div[data-type="toggle-summary"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "toggle-summary",
        class: "toggle-summary",
      }),
      0,
    ];
  },
});

/** Collapsible block content of a toggle. */
export const ToggleContent = Node.create({
  name: "toggleContent",
  content: "block+",
  isolating: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'div[data-type="toggle-content"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "toggle-content",
        class: "toggle-content",
      }),
      0,
    ];
  },
});

/**
 * Toggle: chevron + summary line, block content hidden when closed.
 * Custom implementation (Tiptap's Details extension is paid Pro).
 */
export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "toggleSummary toggleContent",
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element) => element.getAttribute("data-open") !== "false",
        renderHTML: (attributes) => ({ "data-open": String(attributes.open) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "toggle",
        class: "toggle",
      }),
      0,
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.className = "toggle";
      dom.setAttribute("data-type", "toggle");
      dom.setAttribute("data-open", String(node.attrs.open));
      if (node.attrs.blockId) {
        dom.setAttribute("data-block-id", String(node.attrs.blockId));
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "toggle-chevron";
      button.setAttribute("aria-label", "Expand / collapse");
      button.innerHTML = CHEVRON_SVG;
      // Keep the editor selection when clicking the chevron.
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const pos = typeof getPos === "function" ? getPos() : null;
        if (typeof pos !== "number") return;
        const current = editor.state.doc.nodeAt(pos);
        if (!current || current.type.name !== "toggle") return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...current.attrs,
            open: !current.attrs.open,
          })
        );
      });

      const body = document.createElement("div");
      body.className = "toggle-body";

      dom.append(button, body);

      return {
        dom,
        contentDOM: body,
        update(updated) {
          if (updated.type.name !== "toggle") return false;
          dom.setAttribute("data-open", String(updated.attrs.open));
          if (updated.attrs.blockId) {
            dom.setAttribute("data-block-id", String(updated.attrs.blockId));
          }
          return true;
        },
      };
    };
  },

  addKeyboardShortcuts() {
    return {
      // Enter on the summary line: open the toggle and jump into its content.
      Enter: ({ editor }) =>
        editor.commands.command(({ state, tr, dispatch }) => {
          const { $from } = state.selection;
          if ($from.parent.type.name !== "toggleSummary") return false;
          const toggleDepth = $from.depth - 1;
          if (toggleDepth < 0) return false;
          const toggle = $from.node(toggleDepth);
          if (toggle.type.name !== "toggle") return false;
          if (!dispatch) return true;

          const togglePos = $from.before(toggleDepth);
          if (!toggle.attrs.open) {
            tr.setNodeMarkup(togglePos, undefined, {
              ...toggle.attrs,
              open: true,
            });
          }
          // Position just inside toggleContent (after the summary node).
          const contentStart = togglePos + 1 + toggle.child(0).nodeSize + 1;
          tr.setSelection(Selection.near(tr.doc.resolve(contentStart), 1));
          tr.scrollIntoView();
          return true;
        }),

      // Backspace at the very start of the summary: unwrap the toggle into
      // a paragraph (summary text) followed by its content blocks.
      Backspace: ({ editor }) =>
        editor.commands.command(({ state, tr, dispatch }) => {
          const { $from, empty } = state.selection;
          if (
            !empty ||
            $from.parent.type.name !== "toggleSummary" ||
            $from.parentOffset !== 0
          ) {
            return false;
          }
          const toggleDepth = $from.depth - 1;
          if (toggleDepth < 0) return false;
          const toggle = $from.node(toggleDepth);
          if (toggle.type.name !== "toggle") return false;
          if (!dispatch) return true;

          const togglePos = $from.before(toggleDepth);
          const summary = toggle.child(0);
          const content = toggle.child(1);
          const paragraph = state.schema.nodes.paragraph.create(
            null,
            summary.content
          );
          const replacement = Fragment.from(paragraph).append(content.content);
          tr.replaceWith(togglePos, togglePos + toggle.nodeSize, replacement);
          tr.setSelection(TextSelection.create(tr.doc, togglePos + 1));
          tr.scrollIntoView();
          return true;
        }),
    };
  },

  addCommands() {
    return {
      insertToggle:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { open: true },
            content: [
              { type: "toggleSummary" },
              { type: "toggleContent", content: [{ type: "paragraph" }] },
            ],
          }),
    };
  },
});
