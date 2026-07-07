"use client";

import IconPicker from "@/components/page-actions/IconPicker";

/**
 * `IconPicker` floated as a centered overlay above everything — sidebar and
 * main page alike — rather than fitting it into whatever cramped space is
 * beside a trigger. Shared by the page-actions "Change icon" menu item and
 * the inline page-header icon control.
 */
export default function IconPickerOverlay({
  value,
  onSelect,
  onClear,
  onClose,
}: {
  value: string | null;
  onSelect: (icon: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/20"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-md border border-neutral-200 bg-white p-2 text-sm shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <IconPicker
          value={value}
          onSelect={onSelect}
          onClear={onClear}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
