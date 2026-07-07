import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/db/types";

export type AiRole = "user" | "assistant" | "system";

export interface AiConversation {
  id: string;
  title: string | null;
  space_filter: string | null;
  created_at: string;
}

export interface AiMessage {
  id: string;
  conversation_id: string;
  role: AiRole;
  content: string;
  sources: Json | null;
  created_at: string;
}

/** Conversation history for the panel dropdown, newest first. */
export async function listConversations(): Promise<AiConversation[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listConversations failed: ${error.message}`);
  return (data ?? []) as AiConversation[];
}

/** Creates a new conversation, optionally scoped to a space filter. */
export async function createConversation(
  title: string,
  spaceFilter?: string | null
): Promise<AiConversation> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("ai_conversations")
    .insert({ title, space_filter: spaceFilter ?? null })
    .select("*")
    .single();
  if (error) throw new Error(`createConversation failed: ${error.message}`);
  return data as AiConversation;
}

/** Looks up a single conversation by id, or null if it doesn't exist. */
export async function getConversation(
  conversationId: string
): Promise<AiConversation | null> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(`getConversation failed: ${error.message}`);
  return (data as AiConversation | null) ?? null;
}

/** Messages of a conversation in chronological order. */
export async function getMessages(conversationId: string): Promise<AiMessage[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("ai_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getMessages failed: ${error.message}`);
  return (data ?? []) as AiMessage[];
}

/** Appends a message (user or assistant) to a conversation. */
export async function addMessage(
  conversationId: string,
  role: AiRole,
  content: string,
  sources?: Json | null
): Promise<AiMessage> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("ai_messages")
    .insert({
      conversation_id: conversationId,
      role,
      content,
      sources: sources ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(`addMessage failed: ${error.message}`);
  return data as AiMessage;
}

/** Deletes a conversation and (via FK cascade) all of its messages. */
export async function deleteConversation(conversationId: string): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("ai_conversations")
    .delete()
    .eq("id", conversationId);
  if (error) throw new Error(`deleteConversation failed: ${error.message}`);
}
