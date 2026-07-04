import { generateKeyBetween } from "fractional-indexing";

/** Position key for the first item in an empty list. */
export function firstPosition(): string {
  return generateKeyBetween(null, null);
}

/** Position key that sorts immediately after `prev` (append). */
export function positionAfter(prev: string | null | undefined): string {
  return generateKeyBetween(prev ?? null, null);
}

/**
 * Position key that sorts between `a` and `b`.
 * Pass `null` for `a` to insert at the start, `null` for `b` to insert at the end.
 */
export function positionBetween(
  a: string | null | undefined,
  b: string | null | undefined
): string {
  return generateKeyBetween(a ?? null, b ?? null);
}

export { generateKeyBetween };
