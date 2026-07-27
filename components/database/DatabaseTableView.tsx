"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
import {
  createOptionAction,
  createPropertyAction,
  createRowAction,
  deletePropertyAction,
  renamePropertyAction,
  reorderPropertyAction,
  setValueAction,
} from "@/app/actions/databases";
import { deletePageAction } from "@/app/actions/pages";
import { DefaultPageIcon, PageIcon } from "@/lib/icons";
import type {
  DbProperty,
  DbPropertyOption,
  DbPropertyType,
  DbStatusGroup,
  DbValue,
  Page,
} from "@/lib/db/types";
import AddPropertyMenu from "@/components/database/AddPropertyMenu";
import PropertyHeaderMenu from "@/components/database/PropertyHeaderMenu";
import { PROPERTY_TYPE_ICONS } from "@/components/database/propertyTypes";
import { OPTION_COLORS } from "@/components/database/optionColors";
import CheckboxCell from "@/components/database/cells/CheckboxCell";
import DateCell from "@/components/database/cells/DateCell";
import MultiSelectCell from "@/components/database/cells/MultiSelectCell";
import NumberCell from "@/components/database/cells/NumberCell";
import SelectCell from "@/components/database/cells/SelectCell";
import StatusCell from "@/components/database/cells/StatusCell";
import TextCell from "@/components/database/cells/TextCell";

export interface DatabaseTableViewProps {
  databasePageId: string;
  spaceSlug: string;
  properties: DbProperty[];
  optionsByProperty: Record<string, DbPropertyOption[]>;
  rows: Page[];
  valuesByRow: Record<string, Record<string, DbValue>>;
}

/**
 * Renders a database page as a table: rows are child pages, columns are
 * typed properties. Owns optimistic local state seeded from server props
 * (re-seeded whenever the props change, i.e. after a router.refresh()), so
 * edits feel instant while server actions persist in the background.
 */
export default function DatabaseTableView({
  databasePageId,
  spaceSlug,
  properties: initialProperties,
  optionsByProperty: initialOptionsByProperty,
  rows: initialRows,
  valuesByRow: initialValuesByRow,
}: DatabaseTableViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [properties, setProperties] = useState(initialProperties);
  const [rows, setRows] = useState(initialRows);
  const [valuesByRow, setValuesByRow] = useState(initialValuesByRow);
  const [optionsByProperty, setOptionsByProperty] = useState(initialOptionsByProperty);
  const [openHeaderId, setOpenHeaderId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  useEffect(() => setProperties(initialProperties), [initialProperties]);
  useEffect(() => setRows(initialRows), [initialRows]);
  useEffect(() => setValuesByRow(initialValuesByRow), [initialValuesByRow]);
  useEffect(() => setOptionsByProperty(initialOptionsByProperty), [initialOptionsByProperty]);

  const handleSetValue = (rowId: string, propertyId: string, value: DbValue) => {
    setValuesByRow((prev) => ({
      ...prev,
      [rowId]: { ...(prev[rowId] ?? {}), [propertyId]: value },
    }));
    startTransition(async () => {
      await setValueAction(rowId, propertyId, value);
    });
  };

  const handleCreateOption = async (
    propertyId: string,
    label: string,
    statusGroup?: DbStatusGroup | null
  ): Promise<DbPropertyOption> => {
    const existingCount = (optionsByProperty[propertyId] ?? []).length;
    const color = OPTION_COLORS[existingCount % OPTION_COLORS.length];
    const option = await createOptionAction({ propertyId, label, color, statusGroup });
    setOptionsByProperty((prev) => ({
      ...prev,
      [propertyId]: [...(prev[propertyId] ?? []), option],
    }));
    return option;
  };

  const handleAddRow = () => {
    startTransition(async () => {
      const row = await createRowAction(databasePageId);
      setRows((prev) => [...prev, row]);
      router.refresh();
    });
  };

  const handleDeleteRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
    startTransition(async () => {
      await deletePageAction(rowId);
      router.refresh();
    });
  };

  const handleRenameProperty = (id: string, name: string) => {
    setProperties((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
    startTransition(async () => {
      await renamePropertyAction(id, name);
      router.refresh();
    });
  };

  const handleMoveProperty = (id: string, direction: "left" | "right") => {
    const index = properties.findIndex((p) => p.id === id);
    if (index === -1) return;
    const targetIndex = direction === "left" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= properties.length) return;

    const reordered = properties.slice();
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    setProperties(reordered);

    const afterPropertyId = targetIndex === 0 ? null : reordered[targetIndex - 1].id;
    startTransition(async () => {
      await reorderPropertyAction(id, afterPropertyId);
      router.refresh();
    });
  };

  const handleDeleteProperty = (id: string) => {
    setProperties((prev) => prev.filter((p) => p.id !== id));
    startTransition(async () => {
      await deletePropertyAction(id);
      router.refresh();
    });
  };

  const handleCreateProperty = (name: string, type: DbPropertyType) => {
    startTransition(async () => {
      const property = await createPropertyAction({ databasePageId, name, type });
      setProperties((prev) => [...prev, property]);
      router.refresh();
    });
  };

  const renderCell = (property: DbProperty, row: Page) => {
    const value = valuesByRow[row.id]?.[property.id] ?? null;
    const options = optionsByProperty[property.id] ?? [];
    const onChange = (next: DbValue) => handleSetValue(row.id, property.id, next);

    switch (property.type) {
      case "text":
        return <TextCell value={value} onChange={onChange} />;
      case "number":
        return <NumberCell value={value} onChange={onChange} />;
      case "checkbox":
        return <CheckboxCell value={value} onChange={onChange} />;
      case "select":
        return (
          <SelectCell
            value={value}
            options={options}
            onChange={onChange}
            onCreateOption={(label) => handleCreateOption(property.id, label)}
          />
        );
      case "multi_select":
        return (
          <MultiSelectCell
            value={value}
            options={options}
            onChange={onChange}
            onCreateOption={(label) => handleCreateOption(property.id, label)}
          />
        );
      case "status":
        return (
          <StatusCell
            value={value}
            options={options}
            onChange={onChange}
            onCreateOption={(label, statusGroup) =>
              handleCreateOption(property.id, label, statusGroup)
            }
          />
        );
      case "date":
        return <DateCell value={value} onChange={onChange} />;
      default:
        return null;
    }
  };

  return (
    <div className="mt-6 overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
      <table className="w-full min-w-max table-fixed border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 dark:border-neutral-800">
            <th className="min-w-[220px] border-r border-neutral-200 px-3 py-2 text-left text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              Title
            </th>
            {properties.map((property, index) => {
              const Icon = PROPERTY_TYPE_ICONS[property.type];
              return (
                <th
                  key={property.id}
                  className="relative min-w-[140px] border-r border-neutral-200 px-1 py-1 text-left text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400"
                >
                  <button
                    type="button"
                    onClick={() => setOpenHeaderId(property.id)}
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <Icon size={12} className="shrink-0 text-neutral-400 dark:text-neutral-500" />
                    <span className="truncate">{property.name}</span>
                  </button>
                  <PropertyHeaderMenu
                    open={openHeaderId === property.id}
                    onClose={() => setOpenHeaderId(null)}
                    property={property}
                    canMoveLeft={index > 0}
                    canMoveRight={index < properties.length - 1}
                    onRename={(name) => handleRenameProperty(property.id, name)}
                    onMove={(direction) => handleMoveProperty(property.id, direction)}
                    onDelete={() => handleDeleteProperty(property.id)}
                  />
                </th>
              );
            })}
            <th className="relative w-9 px-1 py-1">
              <button
                type="button"
                onClick={() => setAddMenuOpen(true)}
                aria-label="Add property"
                className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                <Plus size={14} />
              </button>
              <AddPropertyMenu
                open={addMenuOpen}
                onClose={() => setAddMenuOpen(false)}
                onCreate={handleCreateProperty}
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="group border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50 dark:border-neutral-800/60 dark:hover:bg-neutral-800/50"
            >
              <td className="border-r border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/${spaceSlug}/${row.id}`}
                    className="flex min-w-0 flex-1 items-center gap-2 truncate hover:underline"
                  >
                    <span className="flex w-4 shrink-0 items-center justify-center leading-none">
                      <PageIcon icon={row.icon} size={14} fallback={<DefaultPageIcon size={14} />} />
                    </span>
                    <span className="truncate">{row.title || "Untitled"}</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDeleteRow(row.id)}
                    aria-label="Delete row"
                    className={clsx(
                      "shrink-0 rounded p-1 text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-neutral-700 dark:hover:text-red-400"
                    )}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </td>
              {properties.map((property) => (
                <td
                  key={property.id}
                  className="border-r border-neutral-200 px-2 py-1 last:border-r-0 dark:border-neutral-800"
                >
                  {renderCell(property, row)}
                </td>
              ))}
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={handleAddRow}
        className="flex w-full items-center gap-1.5 border-t border-neutral-200 px-3 py-2 text-left text-sm text-neutral-400 hover:bg-neutral-50 hover:text-neutral-700 dark:border-neutral-800 dark:hover:bg-neutral-800/50 dark:hover:text-neutral-200"
      >
        <Plus size={14} />
        New row
      </button>
    </div>
  );
}
