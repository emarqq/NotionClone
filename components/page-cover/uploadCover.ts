async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // Non-JSON error body; fall through to the status line.
  }
  return `Upload failed (${response.status})`;
}

/**
 * Uploads a cover image through the existing `/api/files` attachments
 * pipeline and returns the resulting `storage_path` — the value persisted to
 * `pages.cover_url` (never the signed URL, which expires in an hour).
 */
export async function uploadCoverImage(
  pageId: string,
  file: File
): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("pageId", pageId);
  const response = await fetch("/api/files", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) throw new Error(await readError(response));
  const record = (await response.json()) as { storage_path: string };
  return record.storage_path;
}
