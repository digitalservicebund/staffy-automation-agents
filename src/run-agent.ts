// Launches the bugfix agent for one ticket in a child process, continuing the
// ticket's Flue conversation. Shared by `npm run bugfix` and the review sweep.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { BUDGET_EXIT_CODE, RUN_TOKEN_BUDGET } from './budget.ts';
import { LIMITS } from './lifecycle.ts';
import { conversationId } from './review.ts';

// The run hit a cost limit (token budget or time limit): halt, don't retry.
export class RunLimitHit extends Error {}

// Same rule the agent enforces at startup; checked before anything is recorded.
export const canRunAgent = (): boolean => Boolean(process.env.CI) || process.env.ALLOW_LOCAL_SANDBOX === 'true';

export async function runBugfixAgent(ticketGid: string, message: string): Promise<void> {
	// Inherit stdio: flue streams the agent's text, tool calls and status to stderr live.
	const child = spawn('npx', ['flue', 'run', 'src/agents/bugfix.ts', '--id', conversationId(ticketGid), '--message', message], {
		env: process.env,
		stdio: 'inherit',
		timeout: LIMITS.agentRunMs,
	});
	const [code, signal] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];
	if (code === BUDGET_EXIT_CODE) throw new RunLimitHit(`the agent run hit its token budget (${RUN_TOKEN_BUDGET.toLocaleString('en')} tokens)`);
	if (signal) throw new RunLimitHit(`the agent run hit its ${LIMITS.agentRunMs / 60_000} min time limit`);
	if (code !== 0) throw new Error(`agent exited with code ${code}`);
}
