export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** One streamed increment of assistant output. */
export interface ChatDelta {
  text: string;
  done?: boolean;
}

export interface GenerateRequest {
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
}

/** Chat/generation model behind a swappable provider id ('ollama' | 'custom-finetune' | ...). */
export interface LLMProvider {
  readonly id: string;
  chatStream(req: ChatRequest): AsyncIterable<ChatDelta>;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  capabilities(): { contextWindow: number; supportsJsonMode: boolean };
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}

/**
 * Embeddings are configured independently of chat: swapping the chat model for a
 * fine-tune must not force a re-embed of the vault.
 */
export interface EmbeddingProvider {
  readonly id: string;
  /** Must match the chunks.embedding vector(768) column. */
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
