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

/* --- Google Calendar connector (see supabase/migrations/…_google_calendar.sql) --- */

export type CalendarAccountStatus = "connected" | "needs_reauth" | "disconnected";

export interface CalendarAccount {
  id: string;
  provider: "google";
  account_email: string;
  /** Never sent to the client — stripped by lib/db/calendar.ts read helpers. */
  access_token: string | null;
  /** Never sent to the client. */
  refresh_token: string | null;
  token_expires_at: string | null;
  scope: string | null;
  status: CalendarAccountStatus;
  last_error: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/** An account row safe to hand to a client component (no tokens). */
export type CalendarAccountPublic = Omit<
  CalendarAccount,
  "access_token" | "refresh_token" | "token_expires_at" | "scope"
>;

export interface CalendarRow {
  id: string;
  account_id: string;
  google_calendar_id: string;
  summary: string;
  description: string | null;
  time_zone: string | null;
  background_color: string | null;
  foreground_color: string | null;
  /** owner | writer | reader | freeBusyReader — below `writer` means read-only. */
  access_role: string | null;
  is_primary: boolean;
  is_selected: boolean;
  is_write_target: boolean;
  sync_token: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CalendarEventCategory =
  | "class"
  | "quiz"
  | "exam"
  | "assignment"
  | "interview"
  | "coffee_chat"
  | "application"
  | "deadline"
  | "other";

export interface CalendarAttendee {
  email: string | null;
  displayName: string | null;
  responseStatus: string | null;
  organizer: boolean;
  self: boolean;
  optional: boolean;
}

export interface CalendarEvent {
  id: string;
  calendar_id: string;
  google_event_id: string;
  ical_uid: string | null;
  recurring_event_id: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  summary: string;
  description: string | null;
  location: string | null;
  is_all_day: boolean;
  /** Always set. For all-day events these are the bracketing UTC midnights —
   *  query/sort by these, but RENDER all-day events from start_date/end_date. */
  starts_at: string;
  ends_at: string;
  /** All-day only. `end_date` is INCLUSIVE (Google's exclusive end is undone
   *  on the way in by lib/calendar/normalize.ts). */
  start_date: string | null;
  end_date: string | null;
  time_zone: string | null;
  html_link: string | null;
  meeting_url: string | null;
  color_id: string | null;
  attendees: CalendarAttendee[];
  organizer: { email: string | null; displayName: string | null } | null;
  etag: string | null;
  google_updated_at: string | null;
  category: CalendarEventCategory;
  category_source: "auto" | "manual";
  /** The attached note page, if any. */
  page_id: string | null;
  managed_by_app: boolean;
  created_at: string;
  updated_at: string;
}

/** An event plus the display attributes of the calendar it came from, and the
 *  linked note's title/space when there is one. What the calendar UI renders. */
export type CalendarEventWithContext = CalendarEvent & {
  calendar_summary: string;
  calendar_color: string | null;
  calendar_access_role: string | null;
  note_title: string | null;
  note_space_slug: string | null;
};
