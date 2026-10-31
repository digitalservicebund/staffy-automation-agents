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
	// A dispatched revision that hasn't pushed within this window is presumed dead.
	revisionTimeoutMs: 2 * 60 * 60 * 1000,
} as const;

// Persisted per PR, in a hidden marker in a Staffy Bot comment.
export type BotState = {
	ciFixes: number;
	feedbackRounds: number;
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
	| { action: 'fix_ci'; failedChecks: string[]; state: BotState }
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
		return halt(state, `the ${revising.reason} revision did not push within ${LIMITS.revisionTimeoutMs / 3_600_000}h`);
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
		return { action: 'fix_ci', failedChecks: o.failedChecks, state: next };
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
