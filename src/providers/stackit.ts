import { createProvider, envApiKeyAuth } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { setProvider } from '@flue/runtime';

// STACKIT AI Model Serving (OpenAI-compatible). Same env vars as Staffy's
// engagement-summary sync (scripts/utils/llm-client.ts), so one credential set
// serves both. `flue run` only loads the agent module, never app.ts, so agents
// import this file for its side effect instead of registering in app.ts.
const baseUrl = process.env.LLM_BASE_URL;
if (!baseUrl) throw new Error('LLM_BASE_URL is not set');

// Model specifiers for useModel() / subagent `model`.
export const TRIAGE_MODEL = 'stackit/google/gemma-4-31B-it';
export const CODING_MODEL = 'stackit/Qwen/Qwen3.8-27B';
export const TRIAGE_CONTEXT_WINDOW = 256_000;

// Limits from STACKIT's shared-model list:
// https://docs.stackit.cloud/products/data-and-ai/ai-model-serving/basics/available-shared-models/
// Both models *think by default* on STACKIT (verified 2026-10-31: 56–161
// reasoning tokens for a one-line arithmetic question). Declaring
// `reasoning: true` with the qwen-chat-template format makes Pi send
// `chat_template_kwargs.enable_thinking`, which is false whenever the agent's
// thinkingLevel is 'off'. With `reasoning: false` Pi sends nothing, so
// thinking stayed on and dominated token use.
const shared = {
	api: 'openai-completions',
	provider: 'stackit',
	baseUrl,
	reasoning: true,
	compat: { thinkingFormat: 'qwen-chat-template' },
	input: ['text'] as ('text' | 'image')[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as const;

setProvider(
	createProvider({
		id: 'stackit',
		auth: { apiKey: envApiKeyAuth('STACKIT AI Model Serving', ['LLM_API_KEY']) },
		models: [
			{ ...shared, id: 'google/gemma-4-31B-it', name: 'Gemma 4 31B (STACKIT)', contextWindow: TRIAGE_CONTEXT_WINDOW, maxTokens: 4096 },
			// Coding-focused; used for the code-editing steps.
			{ ...shared, id: 'Qwen/Qwen3.8-27B', name: 'Qwen3.8 27B (STACKIT)', contextWindow: 262_000, maxTokens: 16_384 },
		],
		api: openAICompletionsApi(),
	}),
);
