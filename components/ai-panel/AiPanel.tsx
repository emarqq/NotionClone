"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  History,
  Send,
  Sparkles,
  SquarePen,
  StopCircle,
  Trash2,
  X,
} from "lucide-react";
import clsx from "clsx";
import {
  deleteConversationAction,
  getConversationMessagesAction,
  listConversationsAction,
} from "@/app/actions/ai";
import type { AiConversation } from "@/lib/db/ai";
import type { EnrichedSource } from "@/app/api/ai/chat/route";
import type { SpaceOption } from "@/components/tabs/useNewTab";
import { rehydrateAiPanelStore, useAiPanelStore } from "./store";
import { useAiChat, type AiChatMessage } from "./useAiChat";
import MessageBubble from "./MessageBubble";

const ICON_BTN_CLASS =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-800 disabled:pointer-events-none disabled:opacity-35 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";

function formatConversationDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface AiPanelProps {
  spaces: SpaceOption[];
}

/**
 * Right-hand collapsible AI chat panel: space filter, conversation history,
 * streaming messages with inline [n] citation chips, and an always-visible
 * source list under every assistant answer.
 */
export default function AiPanel({ spaces }: AiPanelProps) {
  const open = useAiPanelStore((s) => s.open);
  const hasHydrated = useAiPanelStore((s) => s.hasHydrated);
  const activeConversationId = useAiPanelStore((s) => s.activeConversationId);
  const setActiveConversationId = useAiPanelStore(
    (s) => s.setActiveConversationId
  );
  const setOpen = useAiPanelStore((s) => s.setOpen);
  const graphExpand = useAiPanelStore((s) => s.graphExpand);
  const setGraphExpand = useAiPanelStore((s) => s.setGraphExpand);
  const pendingQuery = useAiPanelStore((s) => s.pendingQuery);
  const setPendingQuery = useAiPanelStore((s) => s.setPendingQuery);

  const [selectedSpaceId, setSelectedSpaceId] = useState<string>("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [input, setInput] = useState("");
  const [loadedConversationId, setLoadedConversationId] = useState<
    string | null
  >(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // A conversation id arriving from an active send() is already backed by
  // this component's live message state — mark it loaded immediately so the
  // restore-from-DB effect below (meant for browser-refresh only) doesn't
  // race a still-streaming answer and clobber it with a stale DB snapshot.
  const handleConversationId = useCallback(
    (id: string) => {
      setActiveConversationId(id);
      setLoadedConversationId(id);
    },
    [setActiveConversationId]
  );

  const { messages, isStreaming, error, send, abort, load, clear } =
    useAiChat(handleConversationId);

  useEffect(() => {
    rehydrateAiPanelStore();
  }, []);

  // Restore the persisted conversation's messages once (browser refresh with
  // an existing kh-ai-panel activeConversationId). In-app navigation never
  // needs this: AiPanel stays mounted inside the (workspace) layout.
  useEffect(() => {
    if (
      !hasHydrated ||
      !activeConversationId ||
      loadedConversationId === activeConversationId
    ) {
      return;
    }
    setLoadedConversationId(activeConversationId);
    getConversationMessagesAction(activeConversationId).then((rows) => {
      load(
        rows
          .filter((m) => m.role !== "system")
          .map(
            (m): AiChatMessage => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              sources:
                m.role === "assistant"
                  ? ((m.sources as unknown as EnrichedSource[] | null) ??
                    undefined)
                  : undefined,
            })
          )
      );
    });
  }, [hasHydrated, activeConversationId, loadedConversationId, load]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  // A query queued by an entry point outside the panel (e.g. the Home "Ask
  // your brain" bar): send it through the normal path and clear the signal.
  useEffect(() => {
    if (!open || !pendingQuery) return;
    const text = pendingQuery;
    setPendingQuery(null);
    send(text, activeConversationId, selectedSpaceId || null, graphExpand);
  }, [
    open,
    pendingQuery,
    activeConversationId,
    selectedSpaceId,
    graphExpand,
    send,
    setPendingQuery,
  ]);

  if (!open) return null;

  const refreshHistory = () => {
    listConversationsAction().then(setConversations);
  };

  const handleToggleHistory = () => {
    setHistoryOpen((v) => {
      if (!v) refreshHistory();
      return !v;
    });
  };

  const handleSelectConversation = (conversation: AiConversation) => {
    setHistoryOpen(false);
    setActiveConversationId(conversation.id);
    setLoadedConversationId(null); // force the restore effect to (re)load it
  };

  const handleDeleteConversation = async (
    e: React.MouseEvent,
    conversation: AiConversation
  ) => {
    e.stopPropagation();
    await deleteConversationAction(conversation.id);
    setConversations((prev) => prev.filter((c) => c.id !== conversation.id));
    if (activeConversationId === conversation.id) {
      setActiveConversationId(null);
      setLoadedConversationId(null);
      clear();
    }
  };

  const handleNewConversation = () => {
    setActiveConversationId(null);
    setLoadedConversationId(null);
    clear();
    textareaRef.current?.focus();
  };

  const handleSend = () => {
    const text = input;
    if (!text.trim() || isStreaming) return;
    setInput("");
    send(text, activeConversationId, selectedSpaceId || null, graphExpand);
  };

  return (
    <aside className="flex h-full w-full flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-neutral-200 px-2 dark:border-neutral-800">
        <Sparkles className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
        <span className="text-[13px] font-medium text-neutral-800 dark:text-neutral-100">
          Assistant
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleNewConversation}
          className={ICON_BTN_CLASS}
          title="New conversation"
          aria-label="New conversation"
        >
          <SquarePen className="h-4 w-4" />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={handleToggleHistory}
            className={ICON_BTN_CLASS}
            title="Conversation history"
            aria-label="Conversation history"
          >
            <History className="h-4 w-4" />
          </button>
          {historyOpen && (
            <>
              <div
                className="fixed inset-0 z-20"
                onClick={() => setHistoryOpen(false)}
              />
              <div className="absolute right-0 top-full z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                {conversations.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-neutral-400">
                    No conversations yet.
                  </p>
                ) : (
                  conversations.map((conversation) => (
                    <div
                      key={conversation.id}
                      onClick={() => handleSelectConversation(conversation)}
                      className={clsx(
                        "group flex cursor-pointer items-center gap-1 px-3 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800",
                        conversation.id === activeConversationId &&
                          "bg-secondary/10 dark:bg-secondary/15"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-neutral-700 dark:text-neutral-200">
                          {conversation.title || "Untitled conversation"}
                        </p>
                        <p className="text-[10px] text-neutral-400">
                          {formatConversationDate(conversation.created_at)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteConversation(e, conversation)}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 opacity-0 hover:bg-neutral-200/70 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-neutral-700"
                        title="Delete conversation"
                        aria-label="Delete conversation"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={ICON_BTN_CLASS}
          title="Close (⌘J)"
          aria-label="Close assistant panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
        <span className="text-[11px] text-neutral-400">Search in</span>
        <select
          value={selectedSpaceId}
          onChange={(e) => setSelectedSpaceId(e.target.value)}
          className="rounded border border-neutral-200 bg-transparent px-1.5 py-0.5 text-[11px] text-neutral-700 outline-none dark:border-neutral-700 dark:text-neutral-200"
        >
          <option value="">All spaces</option>
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <label
          className="flex cursor-pointer items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400"
          title="Also pull in chunks from pages linked to/from the top matches (graph RAG)"
        >
          <input
            type="checkbox"
            checked={graphExpand}
            onChange={(e) => setGraphExpand(e.target.checked)}
            className="h-3 w-3 accent-primary"
          />
          Connect linked notes
        </label>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-2.5 py-3">
        {messages.length === 0 ? (
          <p className="mt-6 px-2 text-center text-[13px] text-neutral-400 dark:text-neutral-500">
            Ask about your notes — answers cite sources.
          </p>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="mx-2.5 mb-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="shrink-0 border-t border-neutral-200 p-2 dark:border-neutral-800">
        <div className="flex items-end gap-1.5">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={isStreaming}
            placeholder="Ask a question…"
            rows={2}
            className="min-h-[2.25rem] flex-1 resize-none rounded-md border border-neutral-200 bg-transparent px-2 py-1.5 text-[13px] text-neutral-800 outline-none placeholder:text-neutral-400 focus:border-neutral-400 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-100 dark:focus:border-neutral-500"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={abort}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90"
              title="Stop generating"
              aria-label="Stop generating"
            >
              <StopCircle className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-35"
              title="Send (Enter)"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
