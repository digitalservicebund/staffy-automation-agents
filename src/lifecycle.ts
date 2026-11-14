// Pure state machine for a bot PR after it is opened: watch CI, auto-fix one
// failure, open the review subtask once green, revise on approver feedback,
// merge on approval — with hard limits so it can never loop. No I/O here.
import type { ApprovalResult } from './approval.ts';
import type { CiState } from './review.ts';

export const LIMITS = {
	// Automated attempts to fix failing CI per PR. A failure after these halts.
	ciFixes: 1,
	// Revision rounds driven by human feedback per PR.
	feedbackRounds: 3,
	// Hard wall-clock limit for one agent run; the sweep kills it after this.
	agentRunMs: 30 * 60 * 1000,
	// A dispatched revision that hasn't pushed within this window is presumed dead
	// (longer than agentRunMs, so a run that is still allowed to work isn't declared dead).
	revisionTimeoutMs: 45 * 60 * 1000,
	// Agent runs that crash or can't start, per PR. Each is refunded; this many halts.
	dispatchFailures: 2,
} as const;

// Persisted per PR, in a hidden marker in a Staffy Bot comment.
export type BotState = {
	ciFixes: number;
	feedbackRounds: number;
	dispatchFailures?: number;
	revising?: { since: string; reason: 'ci' | 'feedback' };
	halted?: string;
};

export const INITIAL_STATE: BotState = { ciFixes: 0, feedbackRounds: 0 };

export type Observation = {
	ci: CiState;
	failedChecks: string[];
	hasReviewSubtask: boolean;
	// From the review subtask and the main ticket; approver-only, after the last push.
	approval: ApprovalResult;
	// Allowlisted PR comments/reviews after the last push.
	prFeedback: string[];
	lastPush: string;
	now: string;
};

export type Decision =
	| { action: 'wait' }
	| { action: 'save'; state: BotState }
	| { action: 'create_review' }
	| { action: 'fix_ci'; failedChecks: string[]; feedback: string[]; state: BotState }
	| { action: 'revise'; feedback: string[]; state: BotState }
	| { action: 'merge'; approverGid: string }
	| { action: 'halt'; reason: string; state: BotState };

const MARKER = /<!-- staffy-bot-state (.*?) -->/;

export function serializeState(state: BotState): string {
	return `<!-- staffy-bot-state ${JSON.stringify(state)} -->`;
}

export function parseState(text: string): BotState {
	const match = MARKER.exec(text);
	if (!match) return INITIAL_STATE;
	try {
		return { ...INITIAL_STATE, ...(JSON.parse(match[1]) as Partial<BotState>) };
	} catch {
		return INITIAL_STATE;
	}
}

function halt(state: BotState, reason: string): Decision {
	return { action: 'halt', reason, state: { ...state, revising: undefined, halted: reason } };
}

// Resolves an in-flight revision: cleared by a new push, halted on timeout.
function settleRevision(state: BotState, o: Observation): Decision | BotState {
	const { revising } = state;
	if (!revising) return state;
	if (Date.parse(o.lastPush) > Date.parse(revising.since)) {
		const { revising: _done, ...rest } = state;
		return { action: 'save', state: rest };
	}
	if (Date.parse(o.now) - Date.parse(revising.since) > LIMITS.revisionTimeoutMs) {
		return halt(state, `the ${revising.reason} revision did not push within ${LIMITS.revisionTimeoutMs / 60_000} min`);
	}
	return { action: 'wait' };
}

function feedbackOf(o: Observation): string[] {
	const asana = o.approval.status === 'changes_requested' ? o.approval.feedback : [];
	return [...asana, ...o.prFeedback];
}

export function decideNext(current: BotState, o: Observation): Decision {
	if (current.halted) return { action: 'wait' };
	const settled = settleRevision(current, o);
	if ('action' in settled) return settled;
	const state = settled;

	if (o.ci === 'pending') return { action: 'wait' };
	if (o.ci === 'failure') {
		if (state.ciFixes >= LIMITS.ciFixes) {
			return halt(state, `CI still failing after ${LIMITS.ciFixes} automated fix (${o.failedChecks.join(', ')})`);
		}
		const next = { ...state, ciFixes: state.ciFixes + 1, revising: { since: o.now, reason: 'ci' as const } };
		return { action: 'fix_ci', failedChecks: o.failedChecks, feedback: feedbackOf(o), state: next };
	}

	const feedback = feedbackOf(o);
	if (feedback.length > 0) {
		if (state.feedbackRounds >= LIMITS.feedbackRounds) {
			return halt(state, `reached ${LIMITS.feedbackRounds} feedback revisions`);
		}
		const next = { ...state, feedbackRounds: state.feedbackRounds + 1, revising: { since: o.now, reason: 'feedback' as const } };
		return { action: 'revise', feedback, state: next };
	}

	if (!o.hasReviewSubtask) return { action: 'create_review' };
	if (o.approval.status === 'approved') return { action: 'merge', approverGid: o.approval.approverGid };
	return { action: 'wait' };
}

// Drops the in-flight revision and gives back the attempt it consumed.
function refund(state: BotState): BotState {
	const { revising, ...rest } = state;
	if (!revising) return rest;
	const counter = revising.reason === 'ci' ? 'ciFixes' : 'feedbackRounds';
	return { ...rest, [counter]: Math.max(0, rest[counter] - 1) };
}

// The agent run never pushed because it crashed or couldn't start. That
// shouldn't burn an attempt or leave the PR locked, but repeated failures halt.
export function recordDispatchFailure(state: BotState, error: string): BotState {
	const failures = (state.dispatchFailures ?? 0) + 1;
	const next = { ...refund(state), dispatchFailures: failures };
	return failures >= LIMITS.dispatchFailures ? { ...next, halted: `the agent failed to run ${failures} times (last: ${error})` } : next;
}

// Manual override (`review:sweep --unstick <pr>`): resumes a halted or stuck PR.
export function unstick(state: BotState): BotState {
	const { halted: _halted, dispatchFailures: _failures, ...rest } = refund(state);
	return rest;
}

// The run hit its token budget or time limit. Unlike a crash this is not refunded or
// retried: a fix that needs more than the budget needs a human.
export function recordBudgetExceeded(state: BotState, reason = 'the agent run hit its token budget'): BotState {
	const { revising: _revising, ...rest } = state;
	return { ...rest, halted: reason };
}
