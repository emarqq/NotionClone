"use server";

import {
  deleteConversation,
  getMessages,
  listConversations,
  type AiConversation,
  type AiMessage,
} from "@/lib/db/ai";

/** Conversation history for the AI panel's history dropdown, newest first. */
export async function listConversationsAction(): Promise<AiConversation[]> {
  return listConversations();
}

/** Messages of a conversation, in chronological order, for loading it into the panel. */
export async function getConversationMessagesAction(
  conversationId: string
): Promise<AiMessage[]> {
  return getMessages(conversationId);
}

export async function deleteConversationAction(
  conversationId: string
): Promise<void> {
  await deleteConversation(conversationId);
}
