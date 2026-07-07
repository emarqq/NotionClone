import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import { getBlocks } from "@/lib/db/blocks";
import { extractCommentAnchors } from "@/lib/comments/extract";
import type {
  Comment,
  CommentThread,
  CommentThreadWithMessages,
} from "@/lib/db/types";

interface CreateThreadInput {
  pageId: string;
  blockId: string | null;
  anchorText: string | null;
  body: string;
}

/**
 * Creates a thread and its first message. The ProseMirror `comment` mark that
 * anchors it is applied client-side after this returns the id; the thread is
 * only created once the user actually submits a message, so cancelling the
 * composer never leaves an orphan.
 */
export async function createThread(
  input: CreateThreadInput
): Promise<{ threadId: string }> {
  const supabase = createServiceSupabase();

  // block_id is a denormalized convenience; reconcilePageComments is the source
  // of truth and backfills it from the mark on the next save. A brand-new block
  // may not be persisted yet when the user comments on it, so only set block_id
  // when the block already exists — otherwise leave it null (no FK violation)
  // and let reconcile fill it in once the mark write lands.
  let blockId: string | null = null;
  if (input.blockId) {
    const { data: block } = await supabase
      .from("blocks")
      .select("id")
      .eq("id", input.blockId)
      .maybeSingle();
    blockId = block ? input.blockId : null;
  }

  const { data: thread, error: threadError } = await supabase
    .from("comment_threads")
    .insert({
      page_id: input.pageId,
      block_id: blockId,
      anchor_text: input.anchorText,
    })
    .select("id")
    .single();
  if (threadError) throw new Error(`createThread failed: ${threadError.message}`);

  const threadId = thread.id as string;
  const { error: commentError } = await supabase
    .from("comments")
    .insert({ thread_id: threadId, body: input.body });
  if (commentError) {
    throw new Error(`createThread comment failed: ${commentError.message}`);
  }

  return { threadId };
}

/**
 * All threads on a page with their messages nested, newest activity first.
 * Comments are fetched in one query and grouped in JS (mirrors getBacklinks's
 * JS-join style — lib/db reads never use SQL joins).
 */
export async function getThreadsForPage(
  pageId: string
): Promise<CommentThreadWithMessages[]> {
  const supabase = createServiceSupabase();

  const { data: threadsData, error: threadsError } = await supabase
    .from("comment_threads")
    .select("*")
    .eq("page_id", pageId);
  if (threadsError) {
    throw new Error(`getThreadsForPage failed: ${threadsError.message}`);
  }
  const threads = (threadsData ?? []) as CommentThread[];
  if (threads.length === 0) return [];

  const threadIds = threads.map((t) => t.id);
  const { data: commentsData, error: commentsError } = await supabase
    .from("comments")
    .select("*")
    .in("thread_id", threadIds)
    .order("created_at", { ascending: true });
  if (commentsError) {
    throw new Error(`getThreadsForPage comments failed: ${commentsError.message}`);
  }

  const byThread = new Map<string, Comment[]>();
  for (const c of (commentsData ?? []) as Comment[]) {
    const list = byThread.get(c.thread_id) ?? [];
    list.push(c);
    byThread.set(c.thread_id, list);
  }

  const lastActivity = (t: CommentThreadWithMessages) =>
    t.comments.length > 0
      ? t.comments[t.comments.length - 1].created_at
      : t.created_at;

  return threads
    .map((t) => ({ ...t, comments: byThread.get(t.id) ?? [] }))
    .sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
}

/** Appends a reply to an existing thread. */
export async function addComment(
  threadId: string,
  body: string
): Promise<Comment> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("comments")
    .insert({ thread_id: threadId, body })
    .select("*")
    .single();
  if (error) throw new Error(`addComment failed: ${error.message}`);
  return data as Comment;
}

/** Marks a thread resolved (or reopens it). The inline mark is removed client-side. */
export async function resolveThread(
  threadId: string,
  resolved: boolean
): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("comment_threads")
    .update({
      resolved,
      resolved_at: resolved ? new Date().toISOString() : null,
    })
    .eq("id", threadId);
  if (error) throw new Error(`resolveThread failed: ${error.message}`);
}

/** Deletes a thread and (via cascade FK) all its messages. */
export async function deleteThread(threadId: string): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("comment_threads")
    .delete()
    .eq("id", threadId);
  if (error) throw new Error(`deleteThread failed: ${error.message}`);
}

/**
 * Re-syncs each thread's anchor with the current blocks (mirrors
 * reconcilePageLinks): threads whose `comment` mark is still present get their
 * `block_id` refreshed (a block split moves the marked text to a new block id)
 * and `orphaned` cleared; threads whose mark has disappeared are flagged
 * `orphaned` — never deleted, so the discussion survives an accidental delete.
 * Runs fire-and-forget after every block save, by which point the mark write is
 * already persisted, so a freshly-created thread is never falsely orphaned.
 */
export async function reconcilePageComments(pageId: string): Promise<void> {
  const supabase = createServiceSupabase();

  const blocks = await getBlocks(pageId);
  const anchors = extractCommentAnchors(
    blocks.map((b) => ({ id: b.id, content: b.content }))
  );
  const blockByThread = new Map(anchors.map((a) => [a.threadId, a.blockId]));

  const { data: existingData, error: existingError } = await supabase
    .from("comment_threads")
    .select("id, block_id, orphaned")
    .eq("page_id", pageId);
  if (existingError) {
    throw new Error(`reconcilePageComments read failed: ${existingError.message}`);
  }
  const existing = (existingData ?? []) as Pick<
    CommentThread,
    "id" | "block_id" | "orphaned"
  >[];

  for (const thread of existing) {
    const anchoredBlock = blockByThread.get(thread.id);
    if (anchoredBlock) {
      // Anchor present — refresh block_id and clear any orphan flag.
      if (thread.block_id !== anchoredBlock || thread.orphaned) {
        const { error } = await supabase
          .from("comment_threads")
          .update({ block_id: anchoredBlock, orphaned: false })
          .eq("id", thread.id);
        if (error) {
          throw new Error(`reconcilePageComments update failed: ${error.message}`);
        }
      }
    } else if (!thread.orphaned) {
      // Anchor gone — flag as orphaned but keep the thread + messages.
      const { error } = await supabase
        .from("comment_threads")
        .update({ orphaned: true })
        .eq("id", thread.id);
      if (error) {
        throw new Error(`reconcilePageComments orphan failed: ${error.message}`);
      }
    }
  }
}
