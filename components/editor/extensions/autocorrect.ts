import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import { useEditorPrefsStore } from "../editorPrefsStore";

// A word just got "completed" when the character before the cursor is one
// of these — matches typing a space/newline/punctuation right after a word.
const BOUNDARY_RE = /[\s.,!?;:)\]}"']/;
const WORD_RE = /[A-Za-z']+$/;

function matchCase(original: string, suggestion: string): string {
  if (original === original.toUpperCase()) return suggestion.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return suggestion[0].toUpperCase() + suggestion.slice(1);
  }
  return suggestion;
}

async function fetchSuggestion(
  word: string,
  signal: AbortSignal
): Promise<{ correct: boolean; suggestion: string | null } | null> {
  try {
    const res = await fetch("/api/spellcheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: word.toLowerCase() }),
      signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as { correct: boolean; suggestion: string | null };
  } catch {
    return null;
  }
}

function maybeAutocorrect(editor: Editor, transaction: Transaction, abortSignal: AbortSignal) {
  if (!useEditorPrefsStore.getState().autocorrect) return;
  if (transaction.getMeta("autocorrect")) return;
  if (!transaction.docChanged) return;

  const { selection } = editor.state;
  if (!selection.empty) return;

  const pos = selection.$from.pos;
  const charBefore = editor.state.doc.textBetween(pos - 1, pos);
  if (!BOUNDARY_RE.test(charBefore)) return;

  if (selection.$from.marks().some((m) => m.type.name === "code")) return;
  if (selection.$from.parent.type.name === "codeBlock") return;

  const precedingText = editor.state.doc.textBetween(Math.max(0, pos - 40), pos - 1);
  const match = precedingText.match(WORD_RE);
  if (!match) return;

  const word = match[0];
  // Contractions' apostrophe, acronyms, and very short/long words are too
  // likely to be false positives or dictionary gaps — leave them alone.
  if (word.length < 3 || word.length > 30) return;
  if (word.length > 1 && word === word.toUpperCase()) return;

  const wordEnd = pos - 1;
  const wordStart = wordEnd - word.length;

  fetchSuggestion(word, abortSignal).then((result) => {
    if (abortSignal.aborted || !result || result.correct || !result.suggestion) return;
    // The doc may have changed while we were waiting on the network —
    // re-check the exact text is still there before touching it.
    if (editor.state.doc.textBetween(wordStart, wordEnd) !== word) return;

    const corrected = matchCase(word, result.suggestion);
    if (corrected === word) return;

    editor
      .chain()
      .command(({ tr }) => {
        tr.insertText(corrected, wordStart, wordEnd);
        tr.setMeta("autocorrect", true);
        return true;
      })
      .run();
  });
}

/** Auto-fixes a completed word against the en dictionary when it finishes
 * with a space/punctuation, mirroring Word/Docs-style autocorrect. */
export const Autocorrect = Extension.create({
  name: "autocorrect",

  addStorage() {
    return { abortController: new AbortController() };
  },

  onCreate() {
    this.editor.on("update", ({ editor, transaction }) => {
      maybeAutocorrect(editor, transaction, this.storage.abortController.signal);
    });
  },

  onDestroy() {
    this.storage.abortController.abort();
  },
});
