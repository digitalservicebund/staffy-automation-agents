import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botTitle, ciState, decideReview, fixBranch, parseReviewPrs, reviewSubtaskName } from './review.ts';
import type { ApprovalResult } from './approval.ts';

test('review subtask name round-trips its PR numbers', () => {
	assert.equal(reviewSubtaskName([12, 13]), '👀☑️ Review: staffy#12 staffy#13');
	assert.deepEqual(parseReviewPrs('👀☑️ Review: staffy#12 staffy#13'), [12, 13]);
});

test('non-review subtasks yield no PRs', () => {
	assert.deepEqual(parseReviewPrs('Write docs for staffy#12'), []);
	assert.deepEqual(parseReviewPrs('👀☑️ Review: nothing here'), []);
	assert.deepEqual(parseReviewPrs('Review: staffy#12'), [], 'needs the 👀☑️ prefix');
});

test('CI is pending with no runs or with runs still in progress', () => {
	assert.equal(ciState([]), 'pending');
	assert.equal(ciState([{ status: 'completed', conclusion: 'success' }, { status: 'in_progress', conclusion: null }]), 'pending');
});

test('CI succeeds when every run succeeded or was skipped/neutral', () => {
	const runs = [
		{ status: 'completed', conclusion: 'success' },
		{ status: 'completed', conclusion: 'skipped' },
		{ status: 'completed', conclusion: 'neutral' },
	];
	assert.equal(ciState(runs), 'success');
});

test('CI fails on any failing, cancelled or timed-out run', () => {
	for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required']) {
		assert.equal(ciState([{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion }]), 'failure');
	}
});

test('merges only when approved and CI is green', () => {
	const approved = { status: 'approved', approverGid: '1' } as const;
	assert.deepEqual(decideReview(approved, 'success'), { action: 'merge', approverGid: '1' });
	assert.deepEqual(decideReview(approved, 'pending'), { action: 'wait' });
	assert.deepEqual(decideReview(approved, 'failure'), { action: 'ci_failed' });
});

test('changes requested go back to the agent regardless of CI', () => {
	const changes: ApprovalResult = { status: 'changes_requested', feedback: ['fix the test'] };
	assert.deepEqual(decideReview(changes, 'success'), { action: 'revise', feedback: ['fix the test'] });
});

test('waits while approval is pending', () => {
	assert.deepEqual(decideReview({ status: 'pending' }, 'success'), { action: 'wait' });
});

test('fix branch is derived from the ticket GID', () => {
	assert.equal(fixBranch('1215062944661222'), 'bot/asana-1215062944661222');
});

test('fix branch rejects anything but a numeric GID', () => {
	for (const bad of ['', 'abc', '123; rm -rf /', '../main', '12 34']) {
		assert.throws(() => fixBranch(bad));
	}
});

test('bot title adds the 🤖🔨 prefix once', () => {
	assert.equal(botTitle('Levels are not saved'), '🤖🔨 Levels are not saved');
	assert.equal(botTitle('🤖🔨 Levels are not saved'), '🤖🔨 Levels are not saved');
	assert.equal(botTitle('  Levels are not saved '), '🤖🔨 Levels are not saved');
});
