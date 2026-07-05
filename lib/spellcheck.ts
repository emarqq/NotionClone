import "server-only";

import NSpell from "nspell";

// Above this edit distance a "suggestion" is too much of a guess to apply
// automatically — surface it to the user instead of silently rewriting
// their word.
const MAX_AUTO_APPLY_DISTANCE = 2;

// nspell's suggest() ranks by its own internal affix-rule ordering, not by
// edit distance or frequency — for transposition typos like "teh" it hands
// back "ten" ahead of "the" (both edit-distance 1, but "ten" is a real,
// unrelated word). Plain Levenshtein can't break that tie either ("the" is
// a transposition, distance 2, while several wrong words sit at distance
// 1), so the handful of typos below are checked before falling back to the
// dictionary at all.
const COMMON_TYPOS: Record<string, string> = {
  teh: "the",
  hte: "the",
  taht: "that",
  adn: "and",
  nad: "and",
  wich: "which",
  waht: "what",
  thier: "their",
  ot: "to",
  fo: "of",
  becuase: "because",
  seperate: "separate",
  definately: "definitely",
  recieve: "receive",
  occured: "occurred",
  untill: "until",
  arent: "aren't",
  cant: "can't",
  dont: "don't",
  im: "I'm",
};

let spellPromise: Promise<NSpell> | null = null;

function loadSpell(): Promise<NSpell> {
  return import("dictionary-en").then(({ default: dictionary }) =>
    NSpell({ aff: Buffer.from(dictionary.aff), dic: Buffer.from(dictionary.dic) })
  );
}

function getSpell(): Promise<NSpell> {
  if (!spellPromise) spellPromise = loadSpell();
  return spellPromise;
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

export interface SpellCheckResult {
  correct: boolean;
  /** A single high-confidence correction, or null if none clears the bar. */
  suggestion: string | null;
}

export async function checkWord(word: string): Promise<SpellCheckResult> {
  const spell = await getSpell();
  if (spell.correct(word)) return { correct: true, suggestion: null };

  const lower = word.toLowerCase();
  const known = COMMON_TYPOS[lower];
  if (known) return { correct: false, suggestion: known };

  const suggestions = spell.suggest(word);
  if (suggestions.length === 0) return { correct: false, suggestion: null };

  const distances = suggestions.map((s) => levenshtein(lower, s.toLowerCase()));
  const minDistance = Math.min(...distances);
  if (minDistance > MAX_AUTO_APPLY_DISTANCE) return { correct: false, suggestion: null };

  // Only auto-apply when exactly one suggestion sits at the closest
  // distance — if several are equally plausible, guessing wrong is worse
  // than leaving the typo for the user to fix by hand.
  const closest = suggestions.filter((_, i) => distances[i] === minDistance);
  if (closest.length !== 1) return { correct: false, suggestion: null };

  return { correct: false, suggestion: closest[0] };
}
