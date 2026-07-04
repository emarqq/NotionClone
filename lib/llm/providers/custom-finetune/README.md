# custom-finetune provider

An OpenAI-compatible chat provider (`POST {base}/chat/completions`, SSE streaming). Point it at
whatever runtime is serving your LoRA fine-tune by setting these env vars — no code changes:

| Env var | Purpose | Default |
|---|---|---|
| `CUSTOM_LLM_BASE_URL` | Base URL, no trailing slash, includes the API version segment | `http://localhost:8000/v1` |
| `CUSTOM_LLM_MODEL` | Model name/id sent in the request body | `custom-finetune` |
| `CUSTOM_LLM_API_KEY` | Optional bearer token; omitted from the request entirely if unset | (none) |

Also set `LLM_PROVIDER=custom-finetune` (or the `llm_provider_id` row in `app_settings`) so the
registry picks this provider up.

## Pointing at a specific runtime

**Ollama serving the fine-tune** (simplest if you've imported the LoRA as an Ollama model, e.g.
via a `Modelfile`):
```
CUSTOM_LLM_BASE_URL=http://localhost:11434/v1
CUSTOM_LLM_MODEL=my-finetune:latest
```
Ollama exposes an OpenAI-compatible `/v1` route alongside its native `/api` one, so no other
changes are needed.

**llama.cpp server** (`llama-server -m my-finetune.gguf --port 8080`):
```
CUSTOM_LLM_BASE_URL=http://localhost:8080/v1
CUSTOM_LLM_MODEL=my-finetune
```

**vLLM** (`vllm serve my-finetune --port 8000`):
```
CUSTOM_LLM_BASE_URL=http://localhost:8000/v1
CUSTOM_LLM_MODEL=my-finetune
```
vLLM's OpenAI server accepts a bearer token via `--api-key`; set `CUSTOM_LLM_API_KEY` to match if
you use it.

## Embeddings stay on Ollama

Do **not** switch `EMBEDDING_PROVIDER` when swapping the chat model. Embeddings are configured
independently (see `docs/ARCHITECTURE.md` §2) precisely so a fine-tune swap is config-only.
Changing the embedding model/dimensions requires a full re-embed of every chunk plus a
`vector(N)` column migration if the dimension changes — a one-off script, not something this
provider does for you. Keep `EMBEDDING_PROVIDER=ollama` with `nomic-embed-text` unless you
intend to run that migration.
