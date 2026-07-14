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
  is_database: boolean;
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

/** A comment thread anchored to a text range (via a ProseMirror `comment` mark). */
export interface CommentThread {
  id: string;
  page_id: string;
  /** Denormalized anchor block; kept fresh by reconcilePageComments. */
  block_id: string | null;
  /** Snapshot of the commented text at creation. */
  anchor_text: string | null;
  resolved: boolean;
  resolved_at: string | null;
  /** True when the anchor mark is no longer present in the page's blocks. */
  orphaned: boolean;
  created_at: string;
  updated_at: string;
}

/** A single message (root or reply) within a comment thread. */
export interface Comment {
  id: string;
  thread_id: string;
  author: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

/** A thread with its messages nested, for rendering the panel/popover. */
export type CommentThreadWithMessages = CommentThread & { comments: Comment[] };

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

export type DbPropertyType = "text" | "number" | "checkbox" | "select" | "multi_select" | "status" | "date";
export type DbOptionColor = "gray" | "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink";
export type DbStatusGroup = "todo" | "in_progress" | "complete";

export interface DbProperty { id: string; database_page_id: string; name: string; type: DbPropertyType; position: string; config: Json; created_at: string; updated_at: string; }
export interface DbPropertyOption { id: string; property_id: string; label: string; color: DbOptionColor | null; position: string; status_group: DbStatusGroup | null; created_at: string; }
export interface DbDateValue { start: string; end: string | null; hasTime: boolean; }
/** text: string | number: number | checkbox: boolean | select/status: option id | multi_select: option ids | date: DbDateValue | unset: null */
export type DbValue = string | number | boolean | string[] | DbDateValue | null;

export interface DbViewConfigColumn { propertyId: string; width?: number; hidden?: boolean; }
export interface DbViewConfig {
  filter: { propertyId: string; op: string; value: Json } | null;
  sorts: { propertyId: string; dir: "asc" | "desc" }[];
  groupBy: string | null;
  dateProperty: string | null;
  /** empty = all properties in db_properties.position order; properties missing from a non-empty array = append VISIBLE at end */
  columns: DbViewConfigColumn[];
}
export type DbViewType = "table" | "board" | "calendar";
export interface DbView { id: string; database_page_id: string; name: string; type: DbViewType; position: string; config: DbViewConfig; created_at: string; updated_at: string; }

export interface DatabaseRowBundle { page: Page; blocks: Block[]; properties: DbProperty[]; values: Record<string, DbValue>; }
