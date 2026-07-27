import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import { firstPosition, positionAfter, positionBetween } from "@/lib/positions";
import { createPage, getChildren, getPage } from "@/lib/db/pages";
import type {
  DbOptionColor,
  DbProperty,
  DbPropertyOption,
  DbPropertyType,
  DbStatusGroup,
  DbValue,
  DbView,
  DbViewConfig,
  Json,
  Page,
} from "@/lib/db/types";

/**
 * Compares fractional-index keys byte-wise (code-unit order), matching how
 * fractional-indexing defines ordering. Do NOT sort these keys in Postgres:
 * the database's locale collation orders e.g. 'Zz' AFTER 'a0', while the
 * fractional-index scheme (and JS `<`) orders 'Zz' BEFORE 'a0'.
 */
const byPositionKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Fills in defaults for any keys missing from a stored view config. */
function parseViewConfig(raw: Json): DbViewConfig {
  const config =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, Json>)
      : {};
  return {
    filter: (config.filter as unknown as DbViewConfig["filter"] | undefined) ?? null,
    sorts: (config.sorts as unknown as DbViewConfig["sorts"] | undefined) ?? [],
    groupBy: (config.groupBy as string | null | undefined) ?? null,
    dateProperty: (config.dateProperty as string | null | undefined) ?? null,
    columns: (config.columns as unknown as DbViewConfig["columns"] | undefined) ?? [],
  };
}

/** Turns a plain page into a database (idempotent view seed — see below). */
export async function turnPageIntoDatabase(pageId: string): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("pages")
    .update({ is_database: true, updated_at: new Date().toISOString() })
    .eq("id", pageId);
  if (error) throw new Error(`turnPageIntoDatabase failed: ${error.message}`);

  // Idempotent default-view seed: only create the "Table" view the first
  // time a page becomes a database. Toggling page -> database -> page ->
  // database again must never create a second view.
  const { data: existingViews, error: viewsError } = await supabase
    .from("db_views")
    .select("id")
    .eq("database_page_id", pageId)
    .limit(1);
  if (viewsError) {
    throw new Error(`turnPageIntoDatabase failed: ${viewsError.message}`);
  }
  if ((existingViews ?? []).length > 0) return;

  const defaultConfig: DbViewConfig = {
    filter: null,
    sorts: [],
    groupBy: null,
    dateProperty: null,
    columns: [],
  };
  const { error: insertError } = await supabase.from("db_views").insert({
    database_page_id: pageId,
    name: "Table",
    type: "table",
    position: firstPosition(),
    config: defaultConfig,
  });
  if (insertError) {
    throw new Error(`turnPageIntoDatabase failed: ${insertError.message}`);
  }
}

/**
 * Turns a database page back into a plain page. Touches nothing else: the
 * database's properties, options, values and views stay in the tables
 * dormant, so re-enabling `is_database` later restores the same schema.
 */
export async function turnDatabaseIntoPage(pageId: string): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("pages")
    .update({ is_database: false, updated_at: new Date().toISOString() })
    .eq("id", pageId);
  if (error) throw new Error(`turnDatabaseIntoPage failed: ${error.message}`);
}

export async function getProperties(
  databasePageId: string
): Promise<DbProperty[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("db_properties")
    .select("*")
    .eq("database_page_id", databasePageId);
  if (error) throw new Error(`getProperties failed: ${error.message}`);
  return ((data ?? []) as DbProperty[])
    .slice()
    .sort((a, b) => byPositionKey(a.position, b.position));
}

async function getProperty(id: string): Promise<DbProperty> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("db_properties")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getProperty failed: ${error.message}`);
  if (!data) throw new Error(`getProperty failed: property ${id} not found`);
  return data as DbProperty;
}

export async function createProperty(input: {
  databasePageId: string;
  name: string;
  type: DbPropertyType;
}): Promise<DbProperty> {
  const supabase = createServiceSupabase();
  const siblings = await getProperties(input.databasePageId);
  const lastPosition = siblings[siblings.length - 1]?.position ?? null;
  const position = lastPosition === null ? firstPosition() : positionAfter(lastPosition);

  const { data, error } = await supabase
    .from("db_properties")
    .insert({
      database_page_id: input.databasePageId,
      name: input.name,
      type: input.type,
      position,
    })
    .select("*")
    .single();
  if (error) throw new Error(`createProperty failed: ${error.message}`);
  return data as DbProperty;
}

export async function renameProperty(
  id: string,
  name: string
): Promise<DbProperty> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("db_properties")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`renameProperty failed: ${error.message}`);
  return data as DbProperty;
}

export async function updatePropertyConfig(
  id: string,
  config: Json
): Promise<DbProperty> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("db_properties")
    .update({ config, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`updatePropertyConfig failed: ${error.message}`);
  return data as DbProperty;
}

/**
 * Reorders a property among its siblings (properties of the same database),
 * placing it directly after `afterPropertyId` (or first, if null) — mirrors
 * how movePage recomputes position for pages.
 */
export async function reorderProperty(
  id: string,
  afterPropertyId: string | null
): Promise<DbProperty> {
  const supabase = createServiceSupabase();
  const property = await getProperty(id);

  const { data: siblingsData, error: siblingsError } = await supabase
    .from("db_properties")
    .select("id, position")
    .eq("database_page_id", property.database_page_id)
    .neq("id", id);
  if (siblingsError) {
    throw new Error(`reorderProperty failed: ${siblingsError.message}`);
  }
  const siblings = ((siblingsData ?? []) as Pick<DbProperty, "id" | "position">[])
    .slice()
    .sort((a, b) => byPositionKey(a.position, b.position));

  let position: string;
  if (afterPropertyId) {
    const index = siblings.findIndex((s) => s.id === afterPropertyId);
    if (index === -1) {
      throw new Error(
        `reorderProperty failed: afterPropertyId ${afterPropertyId} is not a sibling of property ${id}`
      );
    }
    const prev = siblings[index];
    const next = siblings[index + 1] ?? null;
    position = positionBetween(prev.position, next?.position ?? null);
  } else {
    position = positionBetween(null, siblings[0]?.position ?? null);
  }

  const { data, error } = await supabase
    .from("db_properties")
    .update({ position, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`reorderProperty failed: ${error.message}`);
  return data as DbProperty;
}

/**
 * Deletes a property (cascade removes its options and values), then scrubs
 * every view of the same database whose config references the deleted
 * property id — filter/groupBy/dateProperty cleared, sorts/columns entries
 * dropped — so views never point at a dangling property.
 */
export async function deleteProperty(id: string): Promise<void> {
  const supabase = createServiceSupabase();
  const property = await getProperty(id);

  const { error: deleteError } = await supabase
    .from("db_properties")
    .delete()
    .eq("id", id);
  if (deleteError) throw new Error(`deleteProperty failed: ${deleteError.message}`);

  const { data: viewsData, error: viewsError } = await supabase
    .from("db_views")
    .select("id, config")
    .eq("database_page_id", property.database_page_id);
  if (viewsError) throw new Error(`deleteProperty failed: ${viewsError.message}`);

  for (const view of (viewsData ?? []) as Pick<DbView, "id" | "config">[]) {
    const config = parseViewConfig(view.config as unknown as Json);
    let changed = false;

    if (config.filter?.propertyId === id) {
      config.filter = null;
      changed = true;
    }
    const sortsBefore = config.sorts.length;
    config.sorts = config.sorts.filter((s) => s.propertyId !== id);
    if (config.sorts.length !== sortsBefore) changed = true;

    if (config.groupBy === id) {
      config.groupBy = null;
      changed = true;
    }
    if (config.dateProperty === id) {
      config.dateProperty = null;
      changed = true;
    }
    const columnsBefore = config.columns.length;
    config.columns = config.columns.filter((c) => c.propertyId !== id);
    if (config.columns.length !== columnsBefore) changed = true;

    if (!changed) continue;
    const { error: updateError } = await supabase
      .from("db_views")
      .update({ config, updated_at: new Date().toISOString() })
      .eq("id", view.id);
    if (updateError) {
      throw new Error(`deleteProperty failed: ${updateError.message}`);
    }
  }
}

/**
 * All options for all properties of a database, keyed by property_id, each
 * list position-sorted.
 */
export async function getOptionsForDatabase(
  databasePageId: string
): Promise<Record<string, DbPropertyOption[]>> {
  const supabase = createServiceSupabase();
  const properties = await getProperties(databasePageId);
  if (properties.length === 0) return {};

  const { data, error } = await supabase
    .from("db_property_options")
    .select("*")
    .in(
      "property_id",
      properties.map((p) => p.id)
    );
  if (error) throw new Error(`getOptionsForDatabase failed: ${error.message}`);

  const byProperty: Record<string, DbPropertyOption[]> = {};
  for (const option of (data ?? []) as DbPropertyOption[]) {
    (byProperty[option.property_id] ??= []).push(option);
  }
  for (const list of Object.values(byProperty)) {
    list.sort((a, b) => byPositionKey(a.position, b.position));
  }
  return byProperty;
}

async function getOptionsForProperty(
  propertyId: string
): Promise<DbPropertyOption[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("db_property_options")
    .select("*")
    .eq("property_id", propertyId);
  if (error) throw new Error(`getOptionsForProperty failed: ${error.message}`);
  return ((data ?? []) as DbPropertyOption[])
    .slice()
    .sort((a, b) => byPositionKey(a.position, b.position));
}

async function getOption(id: string): Promise<DbPropertyOption> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("db_property_options")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getOption failed: ${error.message}`);
  if (!data) throw new Error(`getOption failed: option ${id} not found`);
  return data as DbPropertyOption;
}

export async function createOption(input: {
  propertyId: string;
  label: string;
  color?: DbOptionColor | null;
  statusGroup?: DbStatusGroup | null;
}): Promise<DbPropertyOption> {
  const supabase = createServiceSupabase();
  const siblings = await getOptionsForProperty(input.propertyId);
  const lastPosition = siblings[siblings.length - 1]?.position ?? null;
  const position = lastPosition === null ? firstPosition() : positionAfter(lastPosition);

  const { data, error } = await supabase
    .from("db_property_options")
    .insert({
      property_id: input.propertyId,
      label: input.label,
      color: input.color ?? null,
      status_group: input.statusGroup ?? null,
      position,
    })
    .select("*")
    .single();
  if (error) throw new Error(`createOption failed: ${error.message}`);
  return data as DbPropertyOption;
}

export async function renameOption(
  id: string,
  label: string
): Promise<DbPropertyOption> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("db_property_options")
    .update({ label })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`renameOption failed: ${error.message}`);
  return data as DbPropertyOption;
}

export async function recolorOption(
  id: string,
  color: DbOptionColor | null
): Promise<DbPropertyOption> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("db_property_options")
    .update({ color })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`recolorOption failed: ${error.message}`);
  return data as DbPropertyOption;
}

export async function reorderOption(
  id: string,
  afterOptionId: string | null
): Promise<DbPropertyOption> {
  const supabase = createServiceSupabase();
  const option = await getOption(id);

  const { data: siblingsData, error: siblingsError } = await supabase
    .from("db_property_options")
    .select("id, position")
    .eq("property_id", option.property_id)
    .neq("id", id);
  if (siblingsError) {
    throw new Error(`reorderOption failed: ${siblingsError.message}`);
  }
  const siblings = ((siblingsData ?? []) as Pick<DbPropertyOption, "id" | "position">[])
    .slice()
    .sort((a, b) => byPositionKey(a.position, b.position));

  let position: string;
  if (afterOptionId) {
    const index = siblings.findIndex((s) => s.id === afterOptionId);
    if (index === -1) {
      throw new Error(
        `reorderOption failed: afterOptionId ${afterOptionId} is not a sibling of option ${id}`
      );
    }
    const prev = siblings[index];
    const next = siblings[index + 1] ?? null;
    position = positionBetween(prev.position, next?.position ?? null);
  } else {
    position = positionBetween(null, siblings[0]?.position ?? null);
  }

  const { data, error } = await supabase
    .from("db_property_options")
    .update({ position })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`reorderOption failed: ${error.message}`);
  return data as DbPropertyOption;
}

/**
 * Deletes an option. Eager sweep first: any row value referencing this
 * option (select/status equality, or membership in a multi_select array) is
 * cleaned up in JS and written back before the option itself is removed —
 * cheaper than relying on a delete cascade and keeps `db_property_values`
 * free of dangling option ids at all times.
 */
export async function deleteOption(id: string): Promise<void> {
  const supabase = createServiceSupabase();
  const option = await getOption(id);
  const property = await getProperty(option.property_id);

  const { data: valuesData, error: valuesError } = await supabase
    .from("db_property_values")
    .select("page_id, property_id, value")
    .eq("property_id", property.id);
  if (valuesError) throw new Error(`deleteOption failed: ${valuesError.message}`);

  const changed: { page_id: string; property_id: string; value: DbValue }[] = [];
  for (const row of (valuesData ?? []) as {
    page_id: string;
    property_id: string;
    value: DbValue;
  }[]) {
    if (property.type === "multi_select" && Array.isArray(row.value)) {
      const filtered = row.value.filter((v) => v !== id);
      if (filtered.length !== row.value.length) {
        changed.push({
          page_id: row.page_id,
          property_id: row.property_id,
          value: filtered.length > 0 ? filtered : null,
        });
      }
    } else if (row.value === id) {
      changed.push({ page_id: row.page_id, property_id: row.property_id, value: null });
    }
  }

  for (const row of changed) {
    // "Unset" is represented by deleting the row, never by writing null:
    // the column is `jsonb not null`, and PostgREST maps JS null to SQL NULL.
    if (row.value === null) {
      const { error: deleteValueError } = await supabase
        .from("db_property_values")
        .delete()
        .eq("page_id", row.page_id)
        .eq("property_id", row.property_id);
      if (deleteValueError) {
        throw new Error(`deleteOption failed: ${deleteValueError.message}`);
      }
      continue;
    }
    const { error: updateError } = await supabase
      .from("db_property_values")
      .update({ value: row.value, updated_at: new Date().toISOString() })
      .eq("page_id", row.page_id)
      .eq("property_id", row.property_id);
    if (updateError) {
      throw new Error(`deleteOption failed: ${updateError.message}`);
    }
  }

  const { error: deleteError } = await supabase
    .from("db_property_options")
    .delete()
    .eq("id", id);
  if (deleteError) throw new Error(`deleteOption failed: ${deleteError.message}`);
}

/** A database's rows are simply its child pages. */
export async function getDatabaseRows(databasePageId: string): Promise<Page[]> {
  return getChildren(databasePageId);
}

export async function createRow(
  databasePageId: string,
  title?: string
): Promise<Page> {
  const database = await getPage(databasePageId);
  if (!database) {
    throw new Error(`createRow failed: database page ${databasePageId} not found`);
  }
  return createPage({
    spaceId: database.space_id,
    parentPageId: databasePageId,
    title,
  });
}

/**
 * Values for a set of rows, outer-keyed by row page id, inner-keyed by
 * property id. One `.in("page_id", rowIds)` query — an unpaginated N x M
 * pivot, fine at personal scale (hundreds of rows), the known ceiling.
 */
export async function getValuesForRows(
  rowIds: string[]
): Promise<Record<string, Record<string, DbValue>>> {
  if (rowIds.length === 0) return {};

  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("db_property_values")
    .select("page_id, property_id, value")
    .in("page_id", rowIds);
  if (error) throw new Error(`getValuesForRows failed: ${error.message}`);

  const byRow: Record<string, Record<string, DbValue>> = {};
  for (const row of (data ?? []) as {
    page_id: string;
    property_id: string;
    value: DbValue;
  }[]) {
    (byRow[row.page_id] ??= {})[row.property_id] = row.value;
  }
  return byRow;
}

export async function setValue(
  rowPageId: string,
  propertyId: string,
  value: DbValue
): Promise<void> {
  const supabase = createServiceSupabase();
  // "Unset" deletes the row instead of writing null: the column is
  // `jsonb not null`, and PostgREST maps JS null to SQL NULL.
  if (value === null) {
    const { error } = await supabase
      .from("db_property_values")
      .delete()
      .eq("page_id", rowPageId)
      .eq("property_id", propertyId);
    if (error) throw new Error(`setValue failed: ${error.message}`);
    return;
  }
  const { error } = await supabase.from("db_property_values").upsert(
    {
      page_id: rowPageId,
      property_id: propertyId,
      value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "page_id,property_id" }
  );
  if (error) throw new Error(`setValue failed: ${error.message}`);
}

export async function getViews(databasePageId: string): Promise<DbView[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("db_views")
    .select("*")
    .eq("database_page_id", databasePageId);
  if (error) throw new Error(`getViews failed: ${error.message}`);
  return ((data ?? []) as (Omit<DbView, "config"> & { config: Json })[])
    .slice()
    .sort((a, b) => byPositionKey(a.position, b.position))
    .map((row) => ({ ...row, config: parseViewConfig(row.config) }));
}
