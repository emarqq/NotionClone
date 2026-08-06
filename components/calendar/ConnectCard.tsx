"use client";

import { useState } from "react";
import { CalendarDays, Check, Copy, KeyRound } from "lucide-react";

/**
 * Every redirect URI that must be registered in the Cloud Console client.
 *
 * Google matches `redirect_uri` byte-for-byte, and the callback is derived from
 * the origin the request actually arrived on — so every origin the app can be
 * opened on needs its own entry, not just the two "usual" ones. Registering
 * only `localhost:3000` and `127.0.0.1:3777` means opening the app at
 * `127.0.0.1:3000` sends Google a URI it has never seen and yields a bare
 * `redirect_uri_mismatch`. This list mirrors `ALLOWED_ORIGINS` ×
 * `OAUTH_CALLBACK_PATH` in lib/calendar/config.ts, which is `server-only` and
 * so can't be imported here — keep the two in step.
 */
const REDIRECT_URIS = [
  "http://localhost:3000/api/calendar/auth/callback",
  "http://127.0.0.1:3000/api/calendar/auth/callback",
  "http://localhost:3777/api/calendar/auth/callback",
  "http://127.0.0.1:3777/api/calendar/auth/callback",
];

/** Copy button with a 1.5s confirmation tick. */
function CopyButton({
  text,
  label,
  children,
}: {
  text: string;
  label: string;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard blocked — the URIs are selectable text either way.
      });
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={label}
      aria-label={label}
      className="flex shrink-0 items-center gap-1 rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {children}
    </button>
  );
}

function CopyableUri({ uri }: { uri: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 dark:border-neutral-700 dark:bg-neutral-950">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[11px] text-neutral-700 dark:text-neutral-300">
        {uri}
      </code>
      <CopyButton text={uri} label={`Copy ${uri}`} />
    </div>
  );
}

/**
 * The full-page state when there is nothing to render a grid from — either the
 * OAuth credentials are missing (a setup problem, only Erik can fix it) or no
 * Google account has been connected yet (a one-click problem).
 */
export default function ConnectCard({
  mode,
}: {
  mode: "unconfigured" | "disconnected";
}) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg rounded-xl border border-neutral-200 bg-white p-7 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <span className="flex size-10 items-center justify-center rounded-lg bg-secondary/10 text-secondary dark:bg-secondary/15">
          {mode === "disconnected" ? (
            <CalendarDays size={20} />
          ) : (
            <KeyRound size={20} />
          )}
        </span>

        {mode === "disconnected" ? (
          <>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Connect your Google Calendar
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              Pull your class schedule, exams, interviews and application
              deadlines into one place. Events land in a month, week or agenda
              view here, get categorised automatically, and every one of them can
              carry a note page — so an interview on Thursday gets a prep doc in
              a single click, and it stays attached.
            </p>
            {/* A real navigation, not <Link>: the OAuth start route answers with
                a 302 to accounts.google.com, and a client-side transition would
                try to render that as a route instead of following it. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/calendar/auth/start"
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <CalendarDays size={15} />
              Connect Google Calendar
            </a>
            <p className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">
              You&apos;ll be sent to Google to sign in. Nothing is written to your
              calendar unless you create or edit an event here.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Google Calendar isn&apos;t configured yet
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              Set{" "}
              <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                GOOGLE_CLIENT_ID
              </code>{" "}
              and{" "}
              <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                GOOGLE_CLIENT_SECRET
              </code>{" "}
              in{" "}
              <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                .env.local
              </code>{" "}
              and restart the server. The full walkthrough — creating the OAuth
              client, adding yourself as a test user — is in{" "}
              <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                docs/GOOGLE-CALENDAR.md
              </code>
              .
            </p>
            <div className="mt-5 flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Authorised redirect URIs
              </p>
              <CopyButton
                text={REDIRECT_URIS.join("\n")}
                label="Copy all redirect URIs"
              >
                <span className="text-[11px] font-medium">Copy all</span>
              </CopyButton>
            </div>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Google matches these byte-for-byte, and the app derives its
              callback from whichever origin you opened it on — so register{" "}
              <strong className="font-semibold">all four</strong>. :3000 is the
              dev server, :3777 is the desktop shell, and{" "}
              <code className="font-mono">localhost</code> and{" "}
              <code className="font-mono">127.0.0.1</code> are different origins
              to Google even though they resolve to the same machine.
            </p>
            <div className="mt-2 space-y-2">
              {REDIRECT_URIS.map((uri) => (
                <CopyableUri key={uri} uri={uri} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
