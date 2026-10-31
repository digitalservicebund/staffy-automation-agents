import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botTitle, ciState, conversationId, fixBranch, parseReviewPrs, reviewSubtaskName, selectPrFeedback } from './review.ts';

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

test('PR feedback keeps only allowlisted, non-empty items after the last push', () => {
	const since = '2026-10-31T10:00:00.000Z';
	const items = [
		{ author: 'mike', createdAt: '2026-10-31T11:00:00.000Z', body: 'Please add a test' },
		{ author: 'mike', createdAt: '2026-10-31T09:00:00.000Z', body: 'stale' },
		{ author: 'someone-else', createdAt: '2026-10-31T11:00:00.000Z', body: 'drive-by' },
		{ author: 'mike', createdAt: '2026-10-31T11:05:00.000Z', body: '   ' },
		{ author: 'Mike', createdAt: '2026-10-31T11:10:00.000Z', body: 'case-insensitive login' },
	];
	assert.deepEqual(selectPrFeedback(items, { logins: ['mike'], since }), ['Please add a test', 'case-insensitive login']);
});

test('conversation id is stable per ticket, so revisions continue the original run', () => {
	assert.equal(conversationId('1219647123076485'), 'bugfix-1219647123076485');
	assert.throws(() => conversationId('../etc'));
});
