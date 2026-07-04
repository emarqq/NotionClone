import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import type { EmbeddingProvider, LLMProvider } from "./types";
import {
  createOllamaEmbeddingProvider,
  createOllamaLLMProvider,
} from "./providers/ollama";
import { createCustomFinetuneLLMProvider } from "./providers/custom-finetune";

const llmFactories: Record<string, () => LLMProvider> = {
  ollama: createOllamaLLMProvider,
  "custom-finetune": createCustomFinetuneLLMProvider,
};

const embeddingFactories: Record<string, () => EmbeddingProvider> = {
  ollama: createOllamaEmbeddingProvider,
};

const llmInstances = new Map<string, LLMProvider>();
const embeddingInstances = new Map<string, EmbeddingProvider>();

/** app_settings override → env → 'ollama'. Cached briefly so every request isn't a settings query. */
let settingsCache: { value: Record<string, string>; at: number } | null = null;
const SETTINGS_TTL_MS = 30_000;

async function providerSettings(): Promise<Record<string, string>> {
  if (settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) {
    return settingsCache.value;
  }
  const value: Record<string, string> = {};
  try {
    const supabase = createServiceSupabase();
    const { data } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["llm_provider_id", "embedding_provider_id"]);
    for (const row of data ?? []) {
      if (typeof row.value === "string") value[row.key] = row.value;
    }
  } catch {
    // Settings are an optional override; fall through to env defaults.
  }
  settingsCache = { value, at: Date.now() };
  return value;
}

function resolve<T>(
  factories: Record<string, () => T>,
  cache: Map<string, T>,
  id: string,
  fallback: string
): T {
  const key = factories[id] ? id : fallback;
  const factory = factories[key];
  if (!factory) throw new Error(`Unknown provider id: ${id}`);
  const cached = cache.get(key);
  if (cached) return cached;
  const instance = factory();
  cache.set(key, instance);
  return instance;
}

/** Active chat/generation provider (RAG panel and all editing tools share this). */
export async function getLLMProvider(): Promise<LLMProvider> {
  const settings = await providerSettings();
  const id = settings.llm_provider_id ?? process.env.LLM_PROVIDER ?? "ollama";
  return resolve(llmFactories, llmInstances, id, "ollama");
}

/** Active embedding provider (kept independent of chat — see lib/llm/types.ts). */
export async function getEmbeddingProvider(): Promise<EmbeddingProvider> {
  const settings = await providerSettings();
  const id =
    settings.embedding_provider_id ?? process.env.EMBEDDING_PROVIDER ?? "ollama";
  return resolve(embeddingFactories, embeddingInstances, id, "ollama");
}
