"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Smile } from "lucide-react";
import { createSpaceAction } from "@/app/actions/pages";
import IconPicker from "@/components/page-actions/IconPicker";
import { PageIcon } from "@/lib/icons";

/** Sidebar button that opens a small dialog to create a new top-level space. */
export default function NewSpaceButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [isPending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setName("");
    setIcon(null);
    setShowIconPicker(false);
  }

  function submit() {
    const trimmed = name.trim();
    if (!trimmed || isPending) return;
    startTransition(async () => {
      const space = await createSpaceAction(trimmed, icon);
      close();
      router.push(`/${space.slug}`);
    });
  }

  return (
    <>
      <button
        type="button"
        title="New space"
        aria-label="New space"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800/70 dark:hover:text-neutral-200"
      >
        <span className="flex w-4 shrink-0 items-center justify-center">
          <Plus size={14} />
        </span>
        New space
      </button>
      {open && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/20"
          onClick={close}
        >
          <div
            className="w-80 rounded-md border border-neutral-200 bg-white p-3 text-sm shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            {showIconPicker ? (
              <IconPicker
                value={icon}
                onSelect={(next) => {
                  setIcon(next);
                  setShowIconPicker(false);
                }}
                onClear={() => {
                  setIcon(null);
                  setShowIconPicker(false);
                }}
                onClose={() => setShowIconPicker(false)}
              />
            ) : (
              <>
                <p className="mb-2 font-medium text-neutral-800 dark:text-neutral-200">
                  New space
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    title="Choose icon"
                    onClick={() => setShowIconPicker(true)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-neutral-200 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  >
                    <PageIcon icon={icon} size={16} fallback={<Smile size={16} />} />
                  </button>
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submit();
                      if (e.key === "Escape") close();
                    }}
                    placeholder="Space name…"
                    className="min-w-0 flex-1 rounded border border-neutral-200 bg-white px-2 py-1.5 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:focus:border-neutral-500"
                  />
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!name.trim() || isPending}
                    onClick={submit}
                    className="rounded bg-neutral-800 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-40 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-300"
                  >
                    Create
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
