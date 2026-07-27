import { Extension, InputRule } from "@tiptap/core";

import { useEditorPrefsStore } from "../editorPrefsStore";

// Fires as you type a lowercase letter that begins a sentence: either at the
// very start of a textblock (`^`) or immediately after sentence-ending
// punctuation + whitespace (`[.!?]\s+`). Group 1 is that letter.
const SENTENCE_START_RE = /(?:^|[.!?]\s+)([a-z])$/;

// Lowercased, dot-stripped tokens that end in a period but do NOT end a
// sentence — so we must not capitalize the following word. `e.g.`/`U.S.`
// collapse to `eg`/`us` after dot-stripping, which is why the set is dot-free.
const ABBREVIATIONS = new Set([
  "etc", "eg", "ie", "vs", "cf", "al", "approx",
  "dr", "mr", "mrs", "ms", "prof", "sr", "jr", "st", "rev", "gen", "sen", "rep",
  "gov", "capt", "lt", "col", "sgt",
  "no", "vol", "fig", "pp", "pg", "ed", "esp", "dept", "est", "inc", "ltd", "co", "corp",
  "us", "uk", "eu", "ph",
  "am", "pm", "min", "max", "avg",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
]);

/**
 * Auto-capitalizes the first letter of a sentence as you type — Notion/Docs
 * style. Implemented as a Tiptap InputRule (not an `on("update")` handler) for
 * one reason: input rules get **free single-Backspace revert** via Tiptap's
 * built-in `undoInputRule`, so an unwanted cap is one Backspace away and won't
 * re-fire.
 *
 * Reads the `autoCapitalize` pref via `getState()` at input time (not at
 * registration), so toggling it in Settings takes effect immediately without
 * rebuilding the editor. Code marks/blocks are already skipped by the
 * input-rules plugin itself, and IME composition never triggers input rules.
 *
 * Skips: links, URL/email runs, abbreviations (`etc.`, `e.g.`, `Dr.`, `U.S.`…),
 * and ellipses (`wait... ok`). Decimals (`3.14`) need no special-casing — a
 * decimal point has no following whitespace, so `[.!?]\s+` never matches it.
 *
 * Position note: during `handleTextInput` the just-typed character is NOT yet
 * in the document (the input-rules plugin matches against the doc text + the
 * pending `text`). `range.to` is therefore the caret, and matching + producing
 * steps prevents the default insertion — so we insert the *uppercase* letter
 * ourselves at the caret rather than replacing an existing position.
 */
export const AutoCapitalize = Extension.create({
  name: "autoCapitalize",

  addInputRules() {
    return [
      new InputRule({
        find: SENTENCE_START_RE,
        handler: ({ state, range, match }) => {
          if (!useEditorPrefsStore.getState().autoCapitalize) return null;
          // Don't hijack typing that replaces a non-empty selection.
          if (!state.selection.empty) return null;

          const letter = match[1];
          if (!letter || !/^[a-z]$/.test(letter)) return null;

          // Caret == where the letter is about to land (not yet in the doc).
          const caret = range.to;
          const $caret = state.doc.resolve(caret);

          // Skip linked text — the caret would inherit a link mark.
          const linkType = state.schema.marks.link;
          if (linkType && $caret.marks().some((m) => m.type === linkType)) {
            return null;
          }

          // Text of the current block before the caret drives the exceptions.
          // Empty prefix (`match[0]` is just the letter) = block start, where
          // no sentence-boundary exception applies (always capitalize).
          const prefix = match[0].slice(0, -1);
          if (prefix.length > 0) {
            const before = state.doc.textBetween($caret.start(), caret);
            const trimmed = before.replace(/\s+$/, "");

            // Ellipsis ("wait... ok" / "wait… ok") isn't a sentence break.
            if (/(?:\.{2,}|…)$/.test(trimmed)) return null;

            // URL / email right before the caret (autolink may not have marked
            // it yet). Skip if the trailing non-space run looks like one.
            const lastToken = (trimmed.match(/\S+$/) || [""])[0];
            if (/:\/\/|@|www\./i.test(lastToken)) return null;

            // Abbreviation — only for a period trigger (never `!`/`?`). Take the
            // trailing letter/dot run before the terminal period, strip dots,
            // and match against the dot-free set.
            if (trimmed.endsWith(".")) {
              const wordRun = (trimmed.slice(0, -1).match(/[A-Za-z.]+$/) || [""])[0];
              if (ABBREVIATIONS.has(wordRun.replace(/\./g, "").toLowerCase())) {
                return null;
              }
            }
          }

          // Insert the uppercased letter at the caret (default insertion of the
          // lowercase letter is prevented once this rule produces a step).
          state.tr.insertText(letter.toUpperCase(), caret, caret);
          return undefined;
        },
      }),
    ];
  },
});
