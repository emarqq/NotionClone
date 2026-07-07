"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import { useThemeStore, type ThemeMode } from "@/components/theme/store";
import ImportDocsSection from "@/components/settings/ImportDocsSection";

const MODES: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** Sidebar button that opens a modal with theme mode + accent color preferences. */
export default function SettingsModal() {
  const [open, setOpen] = useState(false);
  const mode = useThemeStore((s) => s.mode);
  const primaryColor = useThemeStore((s) => s.primaryColor);
  const secondaryColor = useThemeStore((s) => s.secondaryColor);
  const setMode = useThemeStore((s) => s.setMode);
  const setPrimaryColor = useThemeStore((s) => s.setPrimaryColor);
  const setSecondaryColor = useThemeStore((s) => s.setSecondaryColor);

  return (
    <>
      <button
        type="button"
        title="Settings"
        aria-label="Settings"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800/70 dark:hover:text-neutral-200"
      >
        <span className="flex w-4 shrink-0 items-center justify-center">
          <Settings size={14} />
        </span>
        Settings
      </button>
      {open && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/20"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-96 overflow-y-auto rounded-md border border-neutral-200 bg-white p-3 text-sm shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-3 font-medium text-neutral-800 dark:text-neutral-200">
              Appearance
            </p>

            <div className="mb-4">
              <p className="mb-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                Theme
              </p>
              <div className="flex gap-1 rounded-md border border-neutral-200 p-0.5 dark:border-neutral-700">
                {MODES.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMode(value)}
                    className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                      mode === value
                        ? "bg-primary text-primary-foreground"
                        : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-3 flex items-center justify-between">
              <label
                htmlFor="settings-primary-color"
                className="text-xs text-neutral-500 dark:text-neutral-400"
              >
                Primary color
              </label>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-neutral-400 dark:text-neutral-500">
                  {primaryColor}
                </span>
                <input
                  id="settings-primary-color"
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-6 w-8 cursor-pointer rounded border border-neutral-200 bg-transparent dark:border-neutral-700"
                />
              </div>
            </div>

            <div className="mb-4 flex items-center justify-between">
              <label
                htmlFor="settings-secondary-color"
                className="text-xs text-neutral-500 dark:text-neutral-400"
              >
                Secondary color
              </label>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-neutral-400 dark:text-neutral-500">
                  {secondaryColor}
                </span>
                <input
                  id="settings-secondary-color"
                  type="color"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="h-6 w-8 cursor-pointer rounded border border-neutral-200 bg-transparent dark:border-neutral-700"
                />
              </div>
            </div>

            <ImportDocsSection />

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
