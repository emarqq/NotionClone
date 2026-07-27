import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * Notion-style drag handle for reordering TOP-LEVEL blocks.
 *
 * Hovering a block shows a ⠿ grip in the left gutter; dragging it moves that
 * block. This is the pointer counterpart to the existing Alt+↑/↓ shortcut
 * (move-block.ts), which stays the keyboard path.
 *
 * HOW THE DRAG WORKS — deliberately delegated to ProseMirror rather than
 * hand-rolled: on dragstart we put a NodeSelection on the block and hand
 * ProseMirror `view.dragging = { slice, move: true }`. Its own drop handling
 * then removes the source and inserts at the drop point as ONE transaction, so
 * undo restores the original order in a single ⌘Z and the drop position obeys
 * the same schema rules as any other paste. Re-implementing the drop would
 * mean duplicating that logic and getting nesting wrong. The drop indicator is
 * StarterKit's built-in dropcursor — no extra dependency (Tiptap 2.27 has no
 * free official drag-handle; the Pro one is not used here).
 *
 * The handle element lives on document.body and is positioned `fixed` from
 * viewport rects, so no ancestor's `overflow` can clip it and it needs no
 * positioned container. It is recomputed on mousemove and hidden on scroll,
 * which keeps it honest without a scroll-tracking loop.
 */

const HANDLE_GUTTER_PX = 8; // gap between grip and the block's left edge
const HANDLE_SIZE_PX = 20;

interface HoverTarget {
  /** Doc position where the top-level block starts. */
  pos: number;
  rect: DOMRect;
}

/**
 * The top-level block whose vertical extent contains `clientY`.
 *
 * Resolved through posAtDOM + $pos.before(1) rather than by indexing
 * view.dom.children, because widget decorations (the comment gutter adds some)
 * can make DOM child order diverge from doc child order.
 */
function blockAt(view: EditorView, clientY: number): HoverTarget | null {
  const children = Array.from(view.dom.children) as HTMLElement[];
  for (const el of children) {
    const rect = el.getBoundingClientRect();
    if (rect.height === 0) continue;
    if (clientY >= rect.top && clientY <= rect.bottom) {
      try {
        const inner = view.posAtDOM(el, 0);
        if (inner < 0) return null;
        const $pos = view.state.doc.resolve(inner);
        const pos = $pos.depth === 0 ? inner : $pos.before(1);
        return { pos, rect };
      } catch {
        return null;
      }
    }
  }
  return null;
}

export const DragHandle = Extension.create({
  name: "dragHandle",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("dragHandle"),

        view(view) {
          let target: HoverTarget | null = null;

          const handle = document.createElement("div");
          handle.className = "block-drag-handle";
          handle.setAttribute("draggable", "true");
          handle.setAttribute("role", "button");
          handle.setAttribute("aria-label", "Drag to move block");
          handle.setAttribute("contenteditable", "false");
          handle.textContent = "⠿";
          handle.style.display = "none";
          document.body.appendChild(handle);

          const hide = () => {
            handle.style.display = "none";
            target = null;
          };

          const show = (t: HoverTarget) => {
            target = t;
            handle.style.display = "flex";
            handle.style.top = `${t.rect.top + 2}px`;
            handle.style.left = `${t.rect.left - HANDLE_GUTTER_PX - HANDLE_SIZE_PX}px`;
          };

          const onMouseMove = (event: MouseEvent) => {
            if (!view.editable) return hide();
            // Ignore movement while a drag is in progress — the handle would
            // otherwise chase the pointer and re-target mid-drag.
            if (view.dragging) return;
            const found = blockAt(view, event.clientY);
            if (found) show(found);
            else hide();
          };

          const onMouseLeave = (event: MouseEvent) => {
            // Keep it visible while the pointer is on the handle itself.
            if (event.relatedTarget === handle) return;
            hide();
          };

          const onDragStart = (event: DragEvent) => {
            if (!target || !event.dataTransfer) return;
            const { state } = view;
            let selection: NodeSelection;
            try {
              selection = NodeSelection.create(state.doc, target.pos);
            } catch {
              return;
            }
            view.dispatch(state.tr.setSelection(selection));

            const slice = selection.content();
            event.dataTransfer.clearData();
            event.dataTransfer.effectAllowed = "move";
            // Firefox refuses to start a drag without some payload set.
            event.dataTransfer.setData("text/plain", "");
            const dom = view.nodeDOM(target.pos);
            if (dom instanceof HTMLElement) {
              event.dataTransfer.setDragImage(dom, 0, 0);
            }
            // Hand off to ProseMirror: it owns the drop, the source removal,
            // and bundling both into one undoable step.
            view.dragging = { slice, move: true };
          };

          const onDragEnd = () => hide();
          const onClick = () => {
            // A plain click selects the block, giving the same starting point
            // as the Alt+↑/↓ path without requiring a drag.
            if (!target) return;
            try {
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, target.pos)));
              view.focus();
            } catch {
              /* node can't take a NodeSelection — ignore */
            }
          };

          view.dom.addEventListener("mousemove", onMouseMove);
          view.dom.addEventListener("mouseleave", onMouseLeave);
          handle.addEventListener("dragstart", onDragStart);
          handle.addEventListener("dragend", onDragEnd);
          handle.addEventListener("click", onClick);
          // Position is derived from viewport rects, so any scroll staleness is
          // resolved by hiding; the next mousemove re-shows it in place.
          window.addEventListener("scroll", hide, true);

          return {
            destroy() {
              view.dom.removeEventListener("mousemove", onMouseMove);
              view.dom.removeEventListener("mouseleave", onMouseLeave);
              window.removeEventListener("scroll", hide, true);
              handle.remove();
            },
          };
        },
      }),
    ];
  },
});
