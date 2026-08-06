"use client";

import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";

import { useImportStore } from "./importStore";

/**
 * Transient result banner for a Markdown import. The repo has no toast library,
 * so this is a small self-contained one rendered by Editor.
 *
 * It earns its place by reporting the *lossy* parts of a conversion: heading
 * levels the editor can't represent, flattened nested checklists, wikilinks
 * that matched no page. Silently dropping those would look like a broken
 * import. A clean import auto-dismisses; anything with warnings stays until
 * dismissed so the notes can actually be read.
 */
export default function ImportStatusToast() {
  const status = useImportStore((s) => s.status);
  const setStatus = useImportStore((s) => s.setStatus);

  const notes =
    status?.kind === "done"
      ? [
          ...status.outcome.warnings,
          ...(status.outcome.unresolvedMentions.length > 0
            ? [
                `No page matched ${status.outcome.unresolvedMentions
                  .slice(0, 5)
                  .map((t) => `[[${t}]]`)
                  .join(", ")}${
                  status.outcome.unresolvedMentions.length > 5
                    ? ` and ${status.outcome.unresolvedMentions.length - 5} more`
                    : ""
                } — kept as plain text.`,
              ]
            : []),
        ]
      : [];

  // Auto-dismiss only a clean success; warnings and errors wait for the user.
  const autoDismiss = status?.kind === "done" && notes.length === 0;
  useEffect(() => {
    if (!autoDismiss) return;
    const t = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(t);
  }, [autoDismiss, status, setStatus]);

  if (!status) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5">
        {status.kind === "importing" ? (
          <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-neutral-500" />
        ) : status.kind === "error" ? (
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-500" />
        ) : notes.length > 0 ? (
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
        ) : (
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-600" />
        )}

        <div className="min-w-0 flex-1 text-sm">
          {status.kind === "importing" && (
            <p className="text-neutral-700 dark:text-neutral-200">
              Importing <span className="font-medium">{status.fileName}</span>…
            </p>
          )}
          {status.kind === "error" && (
            <p className="text-neutral-700 dark:text-neutral-200">{status.message}</p>
          )}
          {status.kind === "done" && (
            <>
              <p className="text-neutral-700 dark:text-neutral-200">
                Imported <span className="font-medium">{status.outcome.fileName}</span> —{" "}
                {status.outcome.blockCount}{" "}
                {status.outcome.blockCount === 1 ? "block" : "blocks"}
                {status.outcome.resolvedMentions > 0 &&
                  `, ${status.outcome.resolvedMentions} page ${
                    status.outcome.resolvedMentions === 1 ? "link" : "links"
                  }`}
                .
              </p>
              {notes.length > 0 && (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-neutral-500 dark:text-neutral-400">
                  {notes.slice(0, 6).map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                  {notes.length > 6 && <li>…and {notes.length - 6} more.</li>}
                </ul>
              )}
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setStatus(null)}
          className="shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
