import { NextResponse } from "next/server";

import { getFileById, getSignedUrl } from "@/lib/db/files";

const SIGNED_URL_TTL_SECONDS = 300;

/**
 * Stable, non-expiring URL for a stored file (used as `<img src>` in the
 * editor) — redirects to a freshly signed URL on every request so pasted
 * images keep working long after the 1-hour signed-URL TTL would otherwise
 * lapse.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const file = await getFileById(id);
  if (!file) {
    return NextResponse.json({ error: `File ${id} not found.` }, { status: 404 });
  }
  const url = await getSignedUrl(file.storage_path, SIGNED_URL_TTL_SECONDS);
  return NextResponse.redirect(url);
}
