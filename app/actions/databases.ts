"use server";

import { revalidatePath } from "next/cache";
import {
  createOption,
  createProperty,
  createRow,
  deleteOption,
  deleteProperty,
  recolorOption,
  renameOption,
  renameProperty,
  reorderOption,
  reorderProperty,
  setValue,
  turnDatabaseIntoPage,
  turnPageIntoDatabase,
  updatePropertyConfig,
} from "@/lib/db/databases";
import type {
  DbOptionColor,
  DbPropertyOption,
  DbPropertyType,
  DbStatusGroup,
  DbValue,
  DbProperty,
  Json,
  Page,
} from "@/lib/db/types";

/** Turns a plain page into a database; changes the sidebar/tree shape. */
export async function turnPageIntoDatabaseAction(pageId: string): Promise<void> {
  await turnPageIntoDatabase(pageId);
  revalidatePath("/", "layout");
}

/** Turns a database page back into a plain page; changes the sidebar/tree shape. */
export async function turnDatabaseIntoPageAction(pageId: string): Promise<void> {
  await turnDatabaseIntoPage(pageId);
  revalidatePath("/", "layout");
}

export async function createPropertyAction(input: {
  databasePageId: string;
  name: string;
  type: DbPropertyType;
}): Promise<DbProperty> {
  return createProperty(input);
}

export async function renamePropertyAction(
  id: string,
  name: string
): Promise<DbProperty> {
  return renameProperty(id, name);
}

export async function reorderPropertyAction(
  id: string,
  afterPropertyId: string | null
): Promise<DbProperty> {
  return reorderProperty(id, afterPropertyId);
}

export async function updatePropertyConfigAction(
  id: string,
  config: Json
): Promise<DbProperty> {
  return updatePropertyConfig(id, config);
}

export async function deletePropertyAction(id: string): Promise<void> {
  await deleteProperty(id);
}

export async function createOptionAction(input: {
  propertyId: string;
  label: string;
  color?: DbOptionColor | null;
  statusGroup?: DbStatusGroup | null;
}): Promise<DbPropertyOption> {
  return createOption(input);
}

export async function renameOptionAction(
  id: string,
  label: string
): Promise<DbPropertyOption> {
  return renameOption(id, label);
}

export async function recolorOptionAction(
  id: string,
  color: DbOptionColor | null
): Promise<DbPropertyOption> {
  return recolorOption(id, color);
}

export async function reorderOptionAction(
  id: string,
  afterOptionId: string | null
): Promise<DbPropertyOption> {
  return reorderOption(id, afterOptionId);
}

export async function deleteOptionAction(id: string): Promise<void> {
  await deleteOption(id);
}

export async function createRowAction(
  databasePageId: string,
  title?: string
): Promise<Page> {
  return createRow(databasePageId, title);
}

export async function setValueAction(
  rowPageId: string,
  propertyId: string,
  value: DbValue
): Promise<void> {
  await setValue(rowPageId, propertyId, value);
}
