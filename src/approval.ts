// Decides whether a PR's review subtask in Asana has been approved. Runs in
// plain code, never by the model: only the subtask's activity log (who did
// what, when) counts, so a prompt-injected ticket can't approve a merge.

export type Story = {
	resource_subtype: string;
	created_by: { gid: string } | null;
	created_at: string;
	text: string;
};

export type ApprovalResult =
	| { status: 'pending' }
	| { status: 'approved'; approverGid: string }
	| { status: 'changes_requested'; feedback: string[] };

type Options = {
	// Asana user GIDs allowed to approve.
	approverGids: readonly string[];
	// ISO timestamp of the PR's last push; earlier activity is stale.
	since: string;
};

// Every Asana comment the bot posts starts with this. The bot's Asana token
// acts as a real user (possibly an approver), so this is how its own comments
// are told apart from human feedback.
export const BOT_MARK = '🤖';

// Activity that changes the decision. Anything else (assignments, edits) is ignored.
const DECISIVE = new Set(['marked_complete', 'marked_incomplete', 'comment_added']);

export function evaluateApproval(stories: readonly Story[], { approverGids, since }: Options): ApprovalResult {
	const sinceMs = Date.parse(since);
	const relevant = stories
		.filter((s) => DECISIVE.has(s.resource_subtype))
		.filter((s) => !(s.resource_subtype === 'comment_added' && s.text.trimStart().startsWith(BOT_MARK)))
		.filter((s) => s.created_by !== null && approverGids.includes(s.created_by.gid))
		.filter((s) => Date.parse(s.created_at) > sinceMs)
		.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

	const latest = relevant.at(-1);
	if (!latest?.created_by || latest.resource_subtype === 'marked_incomplete') return { status: 'pending' };
	if (latest.resource_subtype === 'marked_complete') {
		return { status: 'approved', approverGid: latest.created_by.gid };
	}

	// Latest is a comment: hand back every approver comment since the last
	// completion change, so feedback split across comments isn't lost.
	const lastToggle = relevant.findLastIndex((s) => s.resource_subtype !== 'comment_added');
	const feedback = relevant.slice(lastToggle + 1).map((s) => s.text);
	return { status: 'changes_requested', feedback };
}
