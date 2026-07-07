"use client";

import { useState, useTransition } from "react";
import { Smile } from "lucide-react";
import { setPageIconAction } from "@/app/actions/pages";
import IconPickerOverlay from "@/components/page-actions/IconPickerOverlay";
import { PageIcon } from "@/lib/icons";

/**
 * Inline icon control shown above the page title: a clickable glyph when an
 * icon is set, or a ghost "Add icon" affordance when it isn't. Both open the
 * same `IconPickerOverlay` used by the page-actions "Change icon" menu item.
 */
export default function PageIconControl({
  pageId,
  icon,
}: {
  pageId: string;
  icon: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  const handleSelect = (next: string | null) => {
    startTransition(async () => {
      await setPageIconAction(pageId, next);
    });
    setOpen(false);
  };

  if (icon) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Change icon"
          className="mt-1 rounded leading-[1.15] hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <PageIcon icon={icon} size={36} />
        </button>
        {open && (
          <IconPickerOverlay
            value={icon}
            onSelect={handleSelect}
            onClear={() => handleSelect(null)}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
      >
        <Smile size={14} />
        Add icon
      </button>
      {open && (
        <IconPickerOverlay
          value={null}
          onSelect={handleSelect}
          onClear={() => handleSelect(null)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
