// Hard token ceiling for one agent run (triage + coder combined). Every model
// turn resends the conversation, so input grows fast; without a cap a stuck
// run can burn millions of tokens before the time limit.
import { observe } from '@flue/runtime';

export const RUN_TOKEN_BUDGET = 1_500_000;
// Exit code the review sweep recognises as "stopped by the budget".
export const BUDGET_EXIT_CODE = 3;

export function createTokenBudget(limit: number) {
	let total = 0;
	return {
		add(usage: { input: number; output: number } | undefined): boolean {
			total += (usage?.input ?? 0) + (usage?.output ?? 0);
			return total >= limit;
		},
		used: () => total,
	};
}

// Watches every model turn in this process (including subagent tasks) and
// kills the run once the budget is spent. Exiting is deliberate: the sweep
// treats the exit code as a stop, and nothing half-done gets pushed.
export function enforceRunBudget(limit = RUN_TOKEN_BUDGET): void {
	const budget = createTokenBudget(limit);
	observe((event) => {
		if (event.type !== 'turn' || !event.response.usage) return;
		if (!budget.add(event.response.usage)) return;
		console.error(`[budget] ${budget.used()} tokens used; limit is ${limit}. Stopping the run.`);
		process.exit(BUDGET_EXIT_CODE);
	});
}
