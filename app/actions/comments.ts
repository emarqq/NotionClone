"use server";

import {
  addComment,
  createThread,
  deleteThread,
  resolveThread,
} from "@/lib/db/comments";
import type { Comment } from "@/lib/db/types";

/**
 * Thin server-action wrappers over lib/db/comments (throw-style, like
 * app/actions/pages.ts, so callers get the created data back). The comments UI
 * reads through GET /api/comments and refetches after each mutation, so no
 * revalidatePath is needed here.
 */

export async function createThreadAction(
  pageId: string,
  blockId: string | null,
  anchorText: string | null,
  body: string
): Promise<{ threadId: string }> {
  return createThread({ pageId, blockId, anchorText, body });
}

export async function addCommentAction(
  threadId: string,
  body: string
): Promise<Comment> {
  return addComment(threadId, body);
}

export async function resolveThreadAction(
  threadId: string,
  resolved: boolean
): Promise<void> {
  await resolveThread(threadId, resolved);
}

export async function deleteThreadAction(threadId: string): Promise<void> {
  await deleteThread(threadId);
}
