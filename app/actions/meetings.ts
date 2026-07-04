"use server";

import { revalidatePath } from "next/cache";
import { createPage, setPageIcon } from "@/lib/db/pages";
import { replacePageBlocks, type BlockInput } from "@/lib/db/blocks";
import { firstPosition, positionAfter } from "@/lib/positions";
import type { BlockType, Json, Page } from "@/lib/db/types";

/*
 * Template node builders. Each returns a full top-level ProseMirror node JSON,
 * mirroring exactly what the editor's blockSync.ts persists (node.toJSON()):
 * the row's `content` is one top-level node whose attrs.blockId matches the
 * block row id. Inner nodes (listItem, taskItem paragraphs) omit blockId —
 * ProseMirror fills attribute defaults on load. Empty text nodes are invalid
 * in ProseMirror, so "empty" paragraphs/list items simply have no text child.
 */

function heading2(blockId: string, text: string): Json {
  return {
    type: "heading",
    attrs: { level: 2, blockId },
    content: [{ type: "text", text }],
  };
}

function paragraph(blockId: string, text?: string): Json {
  const node: { [key: string]: Json } = {
    type: "paragraph",
    attrs: { blockId },
  };
  if (text) node.content = [{ type: "text", text }];
  return node;
}

/** Bullet list with a single empty item. */
function bulletList(blockId: string): Json {
  return {
    type: "bulletList",
    attrs: { blockId },
    content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
  };
}

/** Task list with a single unchecked empty item. */
function taskList(blockId: string): Json {
  return {
    type: "taskList",
    attrs: { blockId },
    content: [
      {
        type: "taskItem",
        attrs: { checked: false },
        content: [{ type: "paragraph" }],
      },
    ],
  };
}

/**
 * Creates a "Meeting — <Mon D, YYYY>" page (icon 🗓️) seeded with a meeting
 * notes template (Details / Attendees / Agenda / Notes), and returns it so
 * the client can navigate to `/${spaceSlug}/${page.id}`.
 */
export async function createMeetingNoteAction(
  spaceId: string,
  spaceSlug: string,
  parentPageId?: string | null
): Promise<Page> {
  const now = new Date();
  const dateLabel = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;

  const created = await createPage({
    spaceId,
    parentPageId: parentPageId ?? null,
    title: `Meeting — ${dateLabel}`,
  });
  const page = await setPageIcon(created.id, "🗓️");

  // Sequential fractional positions (a0, a1, …), same chain blockSync uses.
  const blocks: BlockInput[] = [];
  let prev: string | null = null;
  const push = (type: BlockType, make: (blockId: string) => Json) => {
    const id = crypto.randomUUID();
    const position = prev === null ? firstPosition() : positionAfter(prev);
    prev = position;
    blocks.push({ id, type, content: make(id), position });
  };

  push("heading", (id) => heading2(id, "Details"));
  push("paragraph", (id) =>
    paragraph(id, `Date: ${dateLabel} · Time: ${time}`)
  );
  push("heading", (id) => heading2(id, "Attendees"));
  push("bullet_list", bulletList);
  push("heading", (id) => heading2(id, "Agenda"));
  push("checklist_item", taskList);
  push("heading", (id) => heading2(id, "Notes"));
  push("paragraph", (id) => paragraph(id));

  await replacePageBlocks(page.id, blocks);

  revalidatePath("/", "layout");
  revalidatePath(`/${spaceSlug}`);
  return page;
}
