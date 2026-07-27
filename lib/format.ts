/**
 * Small presentation formatters shared across server and client code.
 *
 * Pure and isomorphic — no I/O, no "server-only", no DOM — so this is safe to
 * import from a server action, a Server Component, and a "use client"
 * component alike (all three currently do).
 */

/**
 * The app's standard short date, e.g. "Jul 26, 2026".
 *
 * Locale is pinned to "en-US" deliberately: this string is used for page
 * metadata and for the auto-generated meeting-note title, where a stable,
 * predictable format matters more than matching the viewer's locale. Anything
 * that should follow the viewer's locale (e.g. the attachments list) formats
 * its own dates and should NOT be folded in here.
 */
export function formatShortDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
