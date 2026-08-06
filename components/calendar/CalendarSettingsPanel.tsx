"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import clsx from "clsx";
import {
  disconnectAccountAction,
  setWriteTargetAction,
  toggleCalendarAction,
} from "@/app/actions/calendar";
import type { CalendarAccountPublic, CalendarRow } from "@/lib/db/types";
import { isWritableRole, useCalendarStore } from "./store";

const STATUS_LABEL: Record<CalendarAccountPublic["status"], string> = {
  connected: "Connected",
  needs_reauth: "Needs reconnecting",
  disconnected: "Disconnected",
};

function syncedLabel(iso: string | null): string {
  if (!iso) return "Never synced";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  return `Synced ${Math.round(hours / 24)}d ago`;
}

export default function CalendarSettingsPanel({
  accounts,
  calendars,
}: {
  accounts: CalendarAccountPublic[];
  calendars: CalendarRow[];
}) {
  const router = useRouter();
  const close = useCalendarStore((s) => s.toggleSettings);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState<string | null>(null);

  // Optimistic overlays. The server actions revalidate and the new props arrive
  // on the next render, but a checkbox that doesn't move on click reads as
  // broken — so the click wins locally until the refreshed props agree.
  const [selectedOverride, setSelectedOverride] = useState<Record<string, boolean>>({});
  const [writeTargetOverride, setWriteTargetOverride] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/20"
      onClick={() => close()}
    >
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
            Calendar settings
          </p>
          <button
            type="button"
            onClick={() => close()}
            aria-label="Close"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {error && (
            <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="space-y-6">
            {accounts.map((account) => {
              const own = calendars.filter((c) => c.account_id === account.id);
              return (
                <section key={account.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
                        {account.account_email}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                        <span
                          className={clsx(
                            "size-1.5 rounded-full",
                            account.status === "connected"
                              ? "bg-emerald-500"
                              : "bg-amber-500"
                          )}
                          aria-hidden
                        />
                        {STATUS_LABEL[account.status]}
                        <span aria-hidden>·</span>
                        {syncedLabel(account.last_synced_at)}
                      </p>
                    </div>

                    {confirmingDisconnect === account.id ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            setConfirmingDisconnect(null);
                            run(() => disconnectAccountAction(account.id));
                          }}
                          className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/50"
                        >
                          Really disconnect
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDisconnect(null)}
                          className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingDisconnect(account.id)}
                        className="shrink-0 rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      >
                        Disconnect
                      </button>
                    )}
                  </div>

                  {confirmingDisconnect === account.id && (
                    <p className="mt-2 rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                      This deletes the local mirror of this account&apos;s
                      calendars and events, and revokes the app&apos;s access at
                      Google. Notes you created stay — they just lose their event
                      link.
                    </p>
                  )}

                  <div className="mt-3 space-y-0.5">
                    {own.length === 0 && (
                      <p className="text-xs text-neutral-400 dark:text-neutral-500">
                        No calendars mirrored yet — run a sync.
                      </p>
                    )}
                    {own.map((calendar) => {
                      const writable = isWritableRole(calendar.access_role);
                      const selected =
                        selectedOverride[calendar.id] ?? calendar.is_selected;
                      const isTarget =
                        writeTargetOverride === null
                          ? calendar.is_write_target
                          : writeTargetOverride === calendar.id;

                      return (
                        <div
                          key={calendar.id}
                          className="rounded-md px-1 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                        >
                          <label className="flex cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={pending}
                              onChange={(event) => {
                                const next = event.target.checked;
                                setSelectedOverride((prev) => ({
                                  ...prev,
                                  [calendar.id]: next,
                                }));
                                run(() => toggleCalendarAction(calendar.id, next));
                              }}
                              className="size-3.5 shrink-0 cursor-pointer accent-primary"
                            />
                            <span
                              className="size-2.5 shrink-0 rounded-sm border border-black/10 dark:border-white/15"
                              style={{
                                backgroundColor:
                                  calendar.background_color ?? "#9ca3af",
                              }}
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1 truncate text-xs text-neutral-700 dark:text-neutral-200">
                              {calendar.summary}
                            </span>
                            {!writable && (
                              <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                                read-only
                              </span>
                            )}
                          </label>

                          {writable && (
                            <label className="mt-1 flex cursor-pointer items-center gap-2 pl-[22px] text-[11px] text-neutral-500 dark:text-neutral-400">
                              <input
                                type="radio"
                                name={`write-target-${account.id}`}
                                checked={isTarget}
                                disabled={pending}
                                onChange={() => {
                                  setWriteTargetOverride(calendar.id);
                                  run(() => setWriteTargetAction(calendar.id));
                                }}
                                className="size-3 cursor-pointer accent-primary"
                              />
                              Default for new events
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>

          {/* Plain <a>: the OAuth start route redirects off-origin. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/api/calendar/auth/start"
            className="mt-6 inline-flex items-center gap-1.5 text-xs font-medium text-secondary hover:underline"
          >
            <Plus size={13} />
            Add another account
          </a>
        </div>
      </div>
    </div>
  );
}
