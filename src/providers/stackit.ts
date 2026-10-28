import { createProvider, envApiKeyAuth } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { setProvider } from '@flue/runtime';

// STACKIT AI Model Serving (OpenAI-compatible). Same env vars as Staffy's
// engagement-summary sync (scripts/utils/llm-client.ts), so one credential set
// serves both. `flue run` only loads the agent module, never app.ts, so agents
// import this file for its side effect instead of registering in app.ts.
const baseUrl = process.env.LLM_BASE_URL;
if (!baseUrl) throw new Error('LLM_BASE_URL is not set');

setProvider(
	createProvider({
		id: 'stackit',
		auth: { apiKey: envApiKeyAuth('STACKIT AI Model Serving', ['LLM_API_KEY']) },
		models: [
			{
				id: 'google/gemma-4-31B-it',
				name: 'Gemma 4 31B (STACKIT)',
				api: 'openai-completions',
				provider: 'stackit',
				baseUrl,
				reasoning: false,
				input: ['text'],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				// Conservative guess — confirm against STACKIT's model card; drives compaction.
				contextWindow: 128000,
				maxTokens: 8192,
			},
		],
		api: openAICompletionsApi(),
	}),
);
