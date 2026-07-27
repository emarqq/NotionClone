import type { DbOptionColor } from "@/lib/db/types";

/**
 * Cycling order for auto-assigning a new option's color: `OPTION_COLORS[existingCount % 8]`.
 */
export const OPTION_COLORS: DbOptionColor[] = [
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
];

const CHIP_CLASSES: Record<DbOptionColor, string> = {
  gray: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  green: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  purple: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  pink: "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300",
};

/** Paired light/dark chip classes for an option color; null (unset) reads as gray. */
export function optionChipClasses(color: DbOptionColor | null): string {
  return CHIP_CLASSES[color ?? "gray"];
}
