"use client";

import Link from "next/link";
import clsx from "clsx";
import { Loader2 } from "lucide-react";
import type { EnrichedSource } from "@/app/api/ai/chat/route";
import type { AiChatMessage } from "./useAiChat";

/** Splits assistant text on `[n]` citation markers, turning each into a small linked superscript chip. */
function renderContentWithCitations(
  content: string,
  sources: EnrichedSource[] | undefined
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /\[(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(content.slice(lastIndex, match.index));
    }
    const n = Number(match[1]);
    const source = sources?.[n - 1];
    nodes.push(
      <sup key={`cite-${key++}`} className="mx-0.5">
        {source?.href ? (
          <Link
            href={source.href}
            className="rounded bg-neutral-200/80 px-1 text-[10px] font-medium text-neutral-600 no-underline hover:bg-neutral-300 dark:bg-neutral-700/80 dark:text-neutral-300 dark:hover:bg-neutral-600"
            title={source.label}
          >
            {n}
          </Link>
        ) : (
          <span className="rounded bg-neutral-200/60 px-1 text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            {n}
          </span>
        )}
      </sup>
    );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < content.length) nodes.push(content.slice(lastIndex));
  return nodes;
}

/**
 * Always-rendered source list under an assistant message — the trust anchor
 * for a small local model, shown independent of whether it emitted [n] marks.
 */
function SourcesList({ sources }: { sources: EnrichedSource[] }) {
  if (sources.length === 0) {
    return (
      <p className="mt-2 text-[11px] italic text-neutral-400 dark:text-neutral-500">
        No matching sources were found in your notes.
      </p>
    );
  }
  return (
    <div className="mt-2 border-t border-neutral-200 pt-2 dark:border-neutral-800">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        Sources
      </p>
      <ol className="space-y-1">
        {sources.map((source, index) => (
          <li key={source.chunkId} className="text-[12px] leading-snug">
            <span className="mr-1 text-neutral-400 dark:text-neutral-500">
              [{index + 1}]
            </span>
            {source.href ? (
              <Link
                href={source.href}
                className="text-neutral-700 hover:underline dark:text-neutral-300"
              >
                {source.label}
              </Link>
            ) : (
              <span className="text-neutral-500 dark:text-neutral-400">
                {source.label}
              </span>
            )}
            {source.headingPath.length > 0 && (
              <span className="text-neutral-400 dark:text-neutral-500">
                {" "}
                — {source.headingPath.join(" > ")}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function MessageBubble({ message }: { message: AiChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={clsx("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={clsx(
          "max-w-[90%] rounded-lg px-3 py-2 text-[13px] leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-neutral-100 text-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <>
            <p className="whitespace-pre-wrap">
              {message.content.length > 0
                ? renderContentWithCitations(message.content, message.sources)
                : null}
              {message.streaming && (
                <Loader2 className="ml-1 inline h-3 w-3 animate-spin align-middle text-neutral-400" />
              )}
            </p>
            {message.sources && <SourcesList sources={message.sources} />}
          </>
        )}
      </div>
    </div>
  );
}
