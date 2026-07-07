"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Loader2,
  Paperclip,
  Plus,
  Trash2,
} from "lucide-react";
import type { FileMeta } from "@/lib/db/types";

type FileWithUrl = FileMeta & { url: string };

/** Refetch signed URLs when the list is older than ~50 min (URLs expire at 60). */
const STALE_URL_MS = 50 * 60 * 1000;

function isImage(file: FileMeta): boolean {
  return file.mime_type.startsWith("image/");
}

function isPdf(file: FileMeta): boolean {
  return file.mime_type === "application/pdf";
}

function iconFor(file: FileMeta) {
  const mime = file.mime_type;
  if (mime.startsWith("image/")) return FileImage;
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime === "application/pdf") return FileText;
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "text/csv" ||
    mime.includes("spreadsheet") ||
    mime.includes("excel")
  ) {
    return FileSpreadsheet;
  }
  if (
    mime.includes("zip") ||
    mime.includes("tar") ||
    mime.includes("compressed")
  ) {
    return FileArchive;
  }
  if (
    mime.includes("json") ||
    mime.includes("javascript") ||
    mime.includes("xml") ||
    mime === "text/html"
  ) {
    return FileCode;
  }
  if (mime.startsWith("text/") || mime.includes("word")) return FileText;
  return File;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function humanDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // Non-JSON error body; fall through to the status line.
  }
  return `Request failed (${response.status})`;
}

interface UploadingFile {
  key: string;
  name: string;
}

export default function AttachmentsPanel({ pageId }: { pageId: string }) {
  const [files, setFiles] = useState<FileWithUrl[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  // undefined = type default (images on, PDFs off); boolean = explicit toggle.
  const [previewOpen, setPreviewOpen] = useState<Record<string, boolean>>({});
  const fetchedAtRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(
        `/api/files?pageId=${encodeURIComponent(pageId)}`
      );
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as { files: FileWithUrl[] };
      setFiles(body.files);
      fetchedAtRef.current = Date.now();
      setError(null);
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to load attachments."
      );
      return false;
    } finally {
      setLoaded(true);
    }
  }, [pageId]);

  useEffect(() => {
    setFiles([]);
    setLoaded(false);
    setError(null);
    setPreviewOpen({});
    void refresh();
  }, [refresh]);

  const uploadFiles = useCallback(
    async (list: FileList | globalThis.File[]) => {
      const items = Array.from(list);
      if (items.length === 0) return;
      setError(null);

      for (const item of items) {
        const key = `${item.name}-${Date.now()}-${Math.random()}`;
        setUploading((prev) => [...prev, { key, name: item.name }]);
        try {
          const formData = new FormData();
          formData.append("file", item);
          formData.append("pageId", pageId);
          const response = await fetch("/api/files", {
            method: "POST",
            body: formData,
          });
          if (!response.ok) throw new Error(await readError(response));
          const created = (await response.json()) as FileWithUrl;
          setFiles((prev) => [...prev, created]);
        } catch (cause) {
          setError(
            cause instanceof Error
              ? `${item.name}: ${cause.message}`
              : `${item.name}: upload failed.`
          );
        } finally {
          setUploading((prev) => prev.filter((entry) => entry.key !== key));
        }
      }
    },
    [pageId]
  );

  const handleDelete = useCallback(async (file: FileWithUrl) => {
    if (!confirm(`Delete "${file.filename}"? This cannot be undone.`)) return;
    try {
      const response = await fetch(
        `/api/files?id=${encodeURIComponent(file.id)}`,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error(await readError(response));
      setFiles((prev) => prev.filter((entry) => entry.id !== file.id));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Delete failed: ${cause.message}`
          : "Delete failed."
      );
    }
  }, []);

  const togglePreview = useCallback(
    (file: FileWithUrl, currentlyOpen: boolean) => {
      const next = !currentlyOpen;
      setPreviewOpen((prev) => ({ ...prev, [file.id]: next }));
      // Signed URLs expire after 1h — refresh them before showing a stale one.
      if (next && Date.now() - fetchedAtRef.current > STALE_URL_MS) {
        void refresh();
      }
    },
    [refresh]
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      if (event.dataTransfer.files.length > 0) {
        void uploadFiles(event.dataTransfer.files);
      }
    },
    [uploadFiles]
  );

  const onDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
  }, []);

  const isEmpty = files.length === 0 && uploading.length === 0;

  return (
    <section
      aria-label="Attachments"
      onDrop={onDrop}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      className={`mt-8 rounded-lg transition-colors ${
        dragActive
          ? "bg-secondary/10 outline-2 outline-dashed outline-secondary dark:bg-secondary/20"
          : ""
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void uploadFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {isEmpty ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
        >
          {loaded ? (
            <Paperclip className="h-4 w-4" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Add attachment
        </button>
      ) : (
        <div className="px-2 py-1">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              <Paperclip className="h-3.5 w-3.5" />
              Attachments
            </h3>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>

          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {files.map((file) => {
              const Icon = iconFor(file);
              const canPreview = isImage(file) || isPdf(file);
              const open = previewOpen[file.id] ?? isImage(file);
              return (
                <li key={file.id} className="py-1.5">
                  <div className="group flex items-center gap-2.5 rounded-md px-1 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
                    <Icon className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" />
                    <span
                      className="min-w-0 flex-1 truncate text-sm text-neutral-800 dark:text-neutral-200"
                      title={file.filename}
                    >
                      {file.filename}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
                      {humanSize(file.size_bytes)}
                    </span>
                    <span className="hidden shrink-0 text-xs text-neutral-400 sm:inline dark:text-neutral-500">
                      {humanDate(file.created_at)}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      {canPreview && (
                        <button
                          type="button"
                          onClick={() => togglePreview(file, open)}
                          title={open ? "Hide preview" : "Show preview"}
                          className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                        >
                          {open ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open in new tab"
                        className="rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      <button
                        type="button"
                        onClick={() => void handleDelete(file)}
                        title="Delete"
                        className="rounded p-1 text-neutral-400 transition-colors hover:bg-red-100 hover:text-red-600 dark:text-neutral-500 dark:hover:bg-red-950 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>

                  {canPreview && open && (
                    <div className="mt-1.5 pl-7">
                      {isImage(file) ? (
                        // eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived; next/image cannot optimize them
                        <img
                          src={file.url}
                          alt={file.filename}
                          className="max-h-96 rounded border border-neutral-200 dark:border-neutral-700"
                        />
                      ) : (
                        <iframe
                          src={file.url}
                          title={file.filename}
                          className="h-96 w-full rounded border border-neutral-200 dark:border-neutral-700"
                        />
                      )}
                    </div>
                  )}
                </li>
              );
            })}

            {uploading.map((entry) => (
              <li
                key={entry.key}
                className="flex items-center gap-2.5 px-1 py-2.5"
              >
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-neutral-400 dark:text-neutral-500" />
                <span className="min-w-0 flex-1 truncate text-sm text-neutral-500 dark:text-neutral-400">
                  {entry.name}
                </span>
                <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                  Uploading…
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="mt-1 px-2 pb-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
