import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOT_MARK, evaluateApproval, type Story } from './approval.ts';

const APPROVER = '100';
const OTHER = '200';
const LAST_PUSH = '2026-10-29T10:00:00.000Z';
const opts = { approverGids: [APPROVER], since: LAST_PUSH };

function story(resource_subtype: string, by: string | null, created_at: string, text = ''): Story {
	return { resource_subtype, created_by: by ? { gid: by } : null, created_at, text };
}

test('pending when nothing happened after the last push', () => {
	assert.deepEqual(evaluateApproval([], opts), { status: 'pending' });
});

test('approved when an approver marks the subtask complete', () => {
	const stories = [story('marked_complete', APPROVER, '2026-10-29T11:00:00.000Z')];
	assert.deepEqual(evaluateApproval(stories, opts), { status: 'approved', approverGid: APPROVER });
});

test('ignores completion by someone not on the allowlist', () => {
	const stories = [story('marked_complete', OTHER, '2026-10-29T11:00:00.000Z')];
	assert.deepEqual(evaluateApproval(stories, opts), { status: 'pending' });
});

test('ignores completion by a rule or integration (no author)', () => {
	const stories = [story('marked_complete', null, '2026-10-29T11:00:00.000Z')];
	assert.deepEqual(evaluateApproval(stories, opts), { status: 'pending' });
});

test('ignores an approval given before the last push', () => {
	const stories = [story('marked_complete', APPROVER, '2026-10-29T09:00:00.000Z')];
	assert.deepEqual(evaluateApproval(stories, opts), { status: 'pending' });
});

test('approver comment requests changes and carries the feedback', () => {
	const stories = [story('comment_added', APPROVER, '2026-10-29T11:00:00.000Z', 'Also handle the empty list')];
	assert.deepEqual(evaluateApproval(stories, opts), {
		status: 'changes_requested',
		feedback: ['Also handle the empty list'],
	});
});

test('comments from non-approvers do not request changes', () => {
	const stories = [story('comment_added', OTHER, '2026-10-29T11:00:00.000Z', 'nit')];
	assert.deepEqual(evaluateApproval(stories, opts), { status: 'pending' });
});

test('the latest decisive event wins, regardless of input order', () => {
	const commentThenApprove = [
		story('marked_complete', APPROVER, '2026-10-29T12:00:00.000Z'),
		story('comment_added', APPROVER, '2026-10-29T11:00:00.000Z', 'looks good once CI passes'),
	];
	assert.equal(evaluateApproval(commentThenApprove, opts).status, 'approved');

	const approveThenComment = [
		story('marked_complete', APPROVER, '2026-10-29T11:00:00.000Z'),
		story('comment_added', APPROVER, '2026-10-29T12:00:00.000Z', 'wait, one more thing'),
	];
	assert.equal(evaluateApproval(approveThenComment, opts).status, 'changes_requested');
});

test('reopening the subtask revokes the approval', () => {
	const stories = [
		story('marked_complete', APPROVER, '2026-10-29T11:00:00.000Z'),
		story('marked_incomplete', APPROVER, '2026-10-29T12:00:00.000Z'),
	];
	assert.deepEqual(evaluateApproval(stories, opts), { status: 'pending' });
});

test("ignores the bot's own comments, which Asana attributes to the approver's account", () => {
	const stories = [story('comment_added', APPROVER, '2026-10-29T11:00:00.000Z', `${BOT_MARK} Staffy Bot pushed a revision.`)];
	assert.deepEqual(evaluateApproval(stories, opts), { status: 'pending' });
});

test('a bot comment after an approval does not revoke it', () => {
	const stories = [
		story('marked_complete', APPROVER, '2026-10-29T11:00:00.000Z'),
		story('comment_added', APPROVER, '2026-10-29T12:00:00.000Z', `${BOT_MARK} Merged after approval.`),
	];
	assert.equal(evaluateApproval(stories, opts).status, 'approved');
});
