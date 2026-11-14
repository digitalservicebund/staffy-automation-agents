// Pure helpers for bot PRs: review-subtask naming, CI state, fix branches,
// ticket titles and PR feedback selection. No I/O here.

export type CiState = 'pending' | 'success' | 'failure';
export type CheckRun = { id?: number; name?: string; status: string; conclusion: string | null; app?: { slug: string } };

const REVIEW_PREFIX = '👀☑️ Review: ';
const PR_REF = /staffy#(\d+)/g;
const PASSING = new Set(['success', 'skipped', 'neutral']);

// The PR numbers live in the subtask name so the review loop can find them
// without trusting free-text descriptions.
export function reviewSubtaskName(prNumbers: readonly number[]): string {
	return `${REVIEW_PREFIX}${prNumbers.map((n) => `staffy#${n}`).join(' ')}`;
}

export function parseReviewPrs(name: string): number[] {
	if (!name.startsWith(REVIEW_PREFIX)) return [];
	return [...name.matchAll(PR_REF)].map((m) => Number(m[1]));
}

export function ciState(runs: readonly CheckRun[]): CiState {
	if (runs.length === 0 || runs.some((r) => r.status !== 'completed')) return 'pending';
	return runs.every((r) => r.conclusion !== null && PASSING.has(r.conclusion)) ? 'success' : 'failure';
}

// One branch per ticket, so a revision pushes to the same PR. The GID is
// model-supplied, so only digits get anywhere near a git ref.
export function fixBranch(ticketGid: string): string {
	if (!/^\d+$/.test(ticketGid)) throw new Error(`Not an Asana task GID: ${JSON.stringify(ticketGid)}`);
	return `bot/asana-${ticketGid}`;
}

const BOT_PREFIX = '🤖🔨 ';

// Marks a ticket as being worked on by the bot. Idempotent across revisions.
export function botTitle(name: string): string {
	const trimmed = name.trim();
	return trimmed.startsWith(BOT_PREFIX) ? trimmed : `${BOT_PREFIX}${trimmed}`;
}

export type PrFeedbackItem = { author: string; createdAt: string; body: string };

// Human feedback on the PR that should drive a revision: allowlisted GitHub
// logins only (the bot never is one), non-empty, and newer than the last push.
export function selectPrFeedback(items: readonly PrFeedbackItem[], { logins, since }: { logins: readonly string[]; since: string }): string[] {
	const allowed = new Set(logins.map((l) => l.toLowerCase()));
	const sinceMs = Date.parse(since);
	return items
		.filter((i) => allowed.has(i.author.toLowerCase()) && Date.parse(i.createdAt) > sinceMs && i.body.trim() !== '')
		.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
		.map((i) => i.body.trim());
}

// Flue conversation id for a ticket. The first fix and every revision share
// it, so the triage agent remembers the ticket, its approach and the coder's
// reports. Validated like the branch name, since the GID is model-supplied.
export function conversationId(ticketGid: string): string {
	return fixBranch(ticketGid).replace('bot/asana-', 'bugfix-');
}
