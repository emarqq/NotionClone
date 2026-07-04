import type { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";

/**
 * Plain text of the document from the start up to `pos`, trimmed to the last
 * `maxChars` characters — "current + preceding few blocks" of context for
 * the 'continue' tool when there is no selection.
 */
export function textBeforePosition(
  editor: Editor,
  pos: number,
  maxChars = 2000
): string {
  const text = editor.state.doc.textBetween(0, pos, "\n\n", "\n");
  return text.slice(-maxChars);
}

/** Builds paragraph (+ hard-break) nodes from plain text returned by an AI tool. */
export function textToNodes(text: string): JSONContent[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) return [{ type: "paragraph" }];
  return paragraphs.map((paragraph) => {
    const lines = paragraph.split("\n");
    const content: JSONContent[] = [];
    lines.forEach((line, i) => {
      if (i > 0) content.push({ type: "hardBreak" });
      if (line) content.push({ type: "text", text: line });
    });
    return {
      type: "paragraph",
      content: content.length > 0 ? content : undefined,
    };
  });
}
