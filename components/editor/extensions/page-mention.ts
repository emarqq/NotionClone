import { mergeAttributes, Node } from "@tiptap/core";

/**
 * PageMention: an inline atom that links to another page. Round-trips
 * losslessly through the block `content` JSON (atom + `data-*` attrs), the
 * way callout.ts round-trips `data-emoji`.
 *
 * - `pageId` is the only attr the backlink extractor needs (see
 *   lib/links/extract.ts); `spaceSlug` is stored so a click navigates without
 *   a lookup (known limitation: stale if the target page changes space —
 *   acceptable for a single-user app).
 * - `renderText` → `[[label]]` so copy/plain-text and RAG extraction read
 *   naturally.
 */
export const PageMention = Node.create({
  name: "pageMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      pageId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-page-id"),
        renderHTML: (attributes) =>
          attributes.pageId ? { "data-page-id": attributes.pageId } : {},
      },
      label: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-label") ?? element.textContent ?? "",
        renderHTML: (attributes) => ({ "data-label": attributes.label }),
      },
      spaceSlug: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-space-slug"),
        renderHTML: (attributes) =>
          attributes.spaceSlug ? { "data-space-slug": attributes.spaceSlug } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-type="page-mention"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { pageId, spaceSlug, label } = node.attrs as {
      pageId: string | null;
      spaceSlug: string | null;
      label: string;
    };
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        "data-type": "page-mention",
        href: spaceSlug && pageId ? `/${spaceSlug}/${pageId}` : "#",
        class: "page-mention",
        contenteditable: "false",
      }),
      label || "Untitled",
    ];
  },

  renderText({ node }) {
    return `[[${(node.attrs.label as string) || "Untitled"}]]`;
  },
});
