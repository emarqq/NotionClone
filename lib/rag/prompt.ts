/** Assembles the RAG chat prompt (system + user) from retrieved sources. Pure — no I/O. */

import type { RetrievedSource } from "@/lib/rag/retriever";

const SYSTEM_PROMPT = `You are a knowledge-base assistant answering questions about the user's own notes and files.
Answer ONLY using the numbered sources below — never use outside knowledge or guess.
After every claim drawn from a source, cite it inline like [1] or [2][3] using its number.
If the sources don't cover the question (even partially), say plainly: "I don't have that in your notes." Do not fabricate details, page names, or citations.
Keep answers concise and direct. Quote sparingly; prefer paraphrasing with a citation.`;

function sourceBlock(source: RetrievedSource, index: number): string {
  const heading = source.headingPath.length > 0 ? ` — ${source.headingPath.join(" > ")}` : "";
  return `[${index + 1}] ${source.title}${heading}\n${source.content}`;
}

/** Builds the {system, user} pair sent to LLMProvider.chatStream for the AI chat panel. */
export function buildRagPrompt(
  question: string,
  sources: RetrievedSource[]
): { system: string; user: string } {
  const sourcesText =
    sources.length > 0
      ? sources.map(sourceBlock).join("\n\n")
      : "(no matching sources were found in the knowledge base)";

  const user = `${sourcesText}\n\nQuestion: ${question}`;

  return { system: SYSTEM_PROMPT, user };
}
