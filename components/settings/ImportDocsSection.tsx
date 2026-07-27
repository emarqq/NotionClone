"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderInput, Upload, Loader2 } from "lucide-react";

/** Default source folder (documented in .env.example as IMPORT_SOURCE_DIR). */
const DEFAULT_SOURCE_DIR = "~/OS/brain-docs";

interface ImportSummary {
  space: { id: string; name: string; slug: string };
  imported: number;
  unchanged: number;
  unsupported: number;
  failed: number;
  skipped: number;
  chunks: { inserted: number; deleted: number; kept: number };
  errors: string[];
}

/**
 * Settings section for importing external documents as read-only reference
 * context (chunked + embedded into RAG, mirrored into the vault). Two inputs:
 * a server-side folder path, and a browser multi-file upload.
 */
export default function ImportDocsSection() {
  const router = useRouter();
  const [dir, setDir] = useState(DEFAULT_SOURCE_DIR);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function runImport(send: () => Promise<Response>) {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const res = await send();
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `Import failed (${res.status}).`);
        return;
      }
      setSummary(data as ImportSummary);
      router.refresh(); // surface the new "Imported" space in the sidebar + AI filter.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  function importFolder() {
    void runImport(() =>
      fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dir }),
      })
    );
  }

  function importFiles(files: FileList) {
    const form = new FormData();
    for (const file of Array.from(files)) form.append("files", file);
    void runImport(() => fetch("/api/import", { method: "POST", body: form }));
  }

  return (
    <div className="mb-4 border-t border-neutral-200 pt-3 dark:border-neutral-700">
      <p className="mb-1 font-medium text-neutral-800 dark:text-neutral-200">
        Import documents
      </p>
      <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
        PDF, Word, Excel, text &amp; Markdown become read-only reference context in a
        dedicated “Imported” space.
      </p>

      <label
        htmlFor="import-source-dir"
        className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400"
      >
        Source folder (on this machine)
      </label>
      <div className="mb-2 flex gap-1.5">
        <input
          id="import-source-dir"
          type="text"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          disabled={busy}
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-neutral-200 bg-transparent px-2 py-1 font-mono text-xs text-neutral-700 outline-none focus:border-primary disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300"
        />
        <button
          type="button"
          onClick={importFolder}
          disabled={busy || dir.trim().length === 0}
          className="flex shrink-0 items-center gap-1 rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <FolderInput size={13} />
          Import
        </button>
      </div>

      <div className="mb-1 flex items-center gap-2 text-xs text-neutral-400 dark:text-neutral-500">
        <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
        or
        <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
      </div>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-neutral-300 px-2 py-1.5 text-xs font-medium text-neutral-500 hover:border-primary hover:text-neutral-700 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        <Upload size={13} />
        Upload files
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.xlsx,.txt,.md"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) importFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {busy && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          <Loader2 size={13} className="animate-spin" />
          Importing &amp; embedding… (this can take a while)
        </p>
      )}

      {error && (
        <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
      )}

      {summary && (
        <div className="mt-2 rounded bg-neutral-50 px-2 py-1.5 text-xs text-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
          <p>
            <span className="font-medium">{summary.imported}</span> imported ·{" "}
            {summary.unchanged} unchanged · {summary.chunks.inserted} new chunks
          </p>
          {(summary.unsupported > 0 || summary.failed > 0 || summary.skipped > 0) && (
            <p className="text-neutral-500 dark:text-neutral-400">
              {summary.unsupported} unsupported · {summary.failed} failed ·{" "}
              {summary.skipped} skipped
            </p>
          )}
          {summary.errors.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-neutral-400 dark:text-neutral-500">
                {summary.errors.length} issue{summary.errors.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-1 max-h-24 overflow-auto">
                {summary.errors.slice(0, 20).map((e, i) => (
                  <li key={i} className="truncate text-neutral-400 dark:text-neutral-500">
                    {e}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
