// Pure decisions for the review loop: which PRs a review subtask covers,
// whether their CI is green, and what to do next. No I/O here.
import type { ApprovalResult } from './approval.ts';

export type CiState = 'pending' | 'success' | 'failure';
export type CheckRun = { status: string; conclusion: string | null };

export type ReviewAction =
	| { action: 'wait' }
	| { action: 'merge'; approverGid: string }
	| { action: 'ci_failed' }
	| { action: 'revise'; feedback: string[] };

const PR_REF = /staffy#(\d+)/g;
const PASSING = new Set(['success', 'skipped', 'neutral']);

// The PR numbers live in the subtask name so the review loop can find them
// without trusting free-text descriptions.
export function reviewSubtaskName(prNumbers: readonly number[]): string {
	return `Review: ${prNumbers.map((n) => `staffy#${n}`).join(' ')}`;
}

export function parseReviewPrs(name: string): number[] {
	if (!name.startsWith('Review: ')) return [];
	return [...name.matchAll(PR_REF)].map((m) => Number(m[1]));
}

export function ciState(runs: readonly CheckRun[]): CiState {
	if (runs.length === 0 || runs.some((r) => r.status !== 'completed')) return 'pending';
	return runs.every((r) => r.conclusion !== null && PASSING.has(r.conclusion)) ? 'success' : 'failure';
}

export function decideReview(approval: ApprovalResult, ci: CiState): ReviewAction {
	if (approval.status === 'changes_requested') return { action: 'revise', feedback: approval.feedback };
	if (approval.status === 'pending') return { action: 'wait' };
	if (ci === 'success') return { action: 'merge', approverGid: approval.approverGid };
	return ci === 'failure' ? { action: 'ci_failed' } : { action: 'wait' };
}
