"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import type { DbPropertyType } from "@/lib/db/types";
import { PROPERTY_TYPES } from "@/components/database/propertyTypes";
import { usePortalPosition } from "@/components/database/usePortalPosition";

/**
 * Portal menu opened from the trailing "+" header button: a name field plus
 * a picker over the 7 property types. Same portal-dropdown pattern as
 * PageActionsMenu / PropertyHeaderMenu.
 */
export default function AddPropertyMenu({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, type: DbPropertyType) => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<DbPropertyType>("text");
  const style = usePortalPosition(anchorRef, panelRef, open);

  useEffect(() => {
    if (open) {
      setName("");
      setType("text");
    }
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, type);
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
            className="z-30 w-64 rounded-md border border-neutral-200 bg-white p-2 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Property name
              </label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onClose();
                }}
                placeholder="Property name"
                className="mb-2 w-full rounded border border-neutral-200 bg-white px-2 py-1 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:focus:border-neutral-500"
              />
              <p className="mb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                Type
              </p>
              <div className="mb-2 grid max-h-52 grid-cols-1 gap-0.5 overflow-y-auto">
                {PROPERTY_TYPES.map(({ type: t, label, icon: Icon }) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={clsx(
                      "flex items-center gap-2 rounded px-2 py-1 text-left",
                      type === t
                        ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                        : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800/60"
                    )}
                  >
                    <Icon size={13} className="shrink-0" />
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!name.trim()}
                  className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </form>
          </div>
        </>,
        document.body
      )}
    </>
  );
}
