/** JSON value stored in jsonb columns. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

export interface Space {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  position: string;
}

export interface Page {
  id: string;
  space_id: string;
  parent_page_id: string | null;
  title: string;
  icon: string | null;
  /** storage_path of a `files` row in the private `attachments` bucket. */
  cover_url: string | null;
  /** Vertical crop offset (0-100) for the cover banner's object-position. */
  cover_position: number;
  /** Fractional-index key (see lib/positions.ts); sort lexicographically. */
  position: string;
  is_archived: boolean;
  is_favorite: boolean;
  last_viewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type BlockType =
  | "paragraph"
  | "heading"
  | "checklist_item"
  | "bullet_list"
  | "ordered_list"
  | "table"
  | "code"
  | "callout"
  | "toggle"
  | "image"
  | "file_embed"
  | "divider"
  | "quote";

export interface Block {
  id: string;
  page_id: string;
  parent_block_id: string | null;
  type: BlockType;
  content: Json;
  /** Fractional-index key; sort lexicographically. */
  position: string;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface PageTag {
  page_id: string;
  tag_id: string;
}

export interface Link {
  id: string;
  source_page_id: string;
  source_block_id: string | null;
  target_page_id: string;
}

export interface FileMeta {
  id: string;
  space_id: string;
  page_id: string | null;
  block_id: string | null;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  extraction_status: string;
  created_at: string;
}

/** A page with its child pages nested, for rendering the sidebar tree. */
export type PageTreeNode = Page & { children: PageTreeNode[] };
