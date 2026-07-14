"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Pencil, Trash2 } from "lucide-react";
import clsx from "clsx";
import type { DbProperty } from "@/lib/db/types";
import { usePortalPosition } from "@/components/database/usePortalPosition";

/**
 * Column-header dropdown for a database property: inline rename, move
 * left/right among siblings, delete. Portaled to <body> and positioned from
 * the header cell's rect, mirroring PageActionsMenu's portal-dropdown
 * pattern (fixed inset-0 backdrop for outside-click close, viewport
 * flip/clamp via usePortalPosition).
 */
export default function PropertyHeaderMenu({
  open,
  onClose,
  property,
  canMoveLeft,
  canMoveRight,
  onRename,
  onMove,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  property: DbProperty;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onRename: (name: string) => void;
  onMove: (direction: "left" | "right") => void;
  onDelete: () => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameValue, setNameValue] = useState(property.name);
  const style = usePortalPosition(anchorRef, panelRef, open);

  useEffect(() => {
    if (!open) setRenaming(false);
  }, [open]);

  useEffect(() => {
    setNameValue(property.name);
  }, [property.name]);

  if (!open) return null;

  const submitRename = () => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== property.name) onRename(trimmed);
    setRenaming(false);
    onClose();
  };

  return (
    <>
      <div ref={anchorRef} className="pointer-events-none absolute inset-0" aria-hidden />
      {createPortal(
        <>
          <div className="fixed inset-0 z-20" onClick={onClose} />
          <div
            ref={panelRef}
            style={style}
            className={clsx(
              "z-30 rounded-md border border-neutral-200 bg-white text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900",
              renaming ? "w-56 p-2" : "w-52 py-1"
            )}
          >
            {renaming ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitRename();
                }}
              >
                <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  Property name
                </label>
                <input
                  autoFocus
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setNameValue(property.name);
                      setRenaming(false);
                    }
                  }}
                  className="mb-2 w-full rounded border border-neutral-200 bg-white px-2 py-1 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:focus:border-neutral-500"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setNameValue(property.name);
                      setRenaming(false);
                    }}
                    className="rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
                  >
                    Save
                  </button>
                </div>
              </form>
            ) : (
              <>
                <MenuItem onClick={() => setRenaming(true)}>
                  <Pencil size={13} className="shrink-0" />
                  Rename
                </MenuItem>
                <MenuItem
                  disabled={!canMoveLeft}
                  onClick={() => {
                    onMove("left");
                    onClose();
                  }}
                >
                  <ArrowLeft size={13} className="shrink-0" />
                  Move left
                </MenuItem>
                <MenuItem
                  disabled={!canMoveRight}
                  onClick={() => {
                    onMove("right");
                    onClose();
                  }}
                >
                  <ArrowRight size={13} className="shrink-0" />
                  Move right
                </MenuItem>
                <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
                <MenuItem
                  danger
                  onClick={() => {
                    onDelete();
                    onClose();
                  }}
                >
                  <Trash2 size={13} className="shrink-0" />
                  Delete property
                </MenuItem>
              </>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

function MenuItem({
  onClick,
  danger = false,
  disabled = false,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "flex w-full items-center gap-2 px-3 py-1 text-left",
        disabled
          ? "cursor-not-allowed text-neutral-300 dark:text-neutral-700"
          : danger
            ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
            : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
      )}
    >
      {children}
    </button>
  );
}
