import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	decideNext,
	INITIAL_STATE,
	LIMITS,
	parseState,
	serializeState,
	type BotState,
	type Observation,
} from './lifecycle.ts';

const PUSH = '2026-10-31T10:00:00.000Z';
const LATER = '2026-10-31T10:30:00.000Z';

function obs(overrides: Partial<Observation> = {}): Observation {
	return {
		ci: 'success',
		failedChecks: [],
		hasReviewSubtask: true,
		approval: { status: 'pending' },
		prFeedback: [],
		lastPush: PUSH,
		now: LATER,
		...overrides,
	};
}

test('state round-trips through the hidden PR comment marker', () => {
	const state: BotState = { ciFixes: 1, feedbackRounds: 2, revising: { since: PUSH, reason: 'ci' } };
	assert.deepEqual(parseState(`Some text\n${serializeState(state)}`), state);
});

test('missing or corrupt state falls back to the initial state', () => {
	assert.deepEqual(parseState('no marker here'), INITIAL_STATE);
	assert.deepEqual(parseState('<!-- staffy-bot-state {not json} -->'), INITIAL_STATE);
});

test('waits while CI is running', () => {
	assert.deepEqual(decideNext(INITIAL_STATE, obs({ ci: 'pending', hasReviewSubtask: false })), { action: 'wait' });
});

test('creates the review subtask only once CI is green', () => {
	assert.deepEqual(decideNext(INITIAL_STATE, obs({ hasReviewSubtask: false })), { action: 'create_review' });
});

test('first CI failure triggers one automated fix', () => {
	const next = decideNext(INITIAL_STATE, obs({ ci: 'failure', failedChecks: ['typecheck'], hasReviewSubtask: false }));
	assert.deepEqual(next, {
		action: 'fix_ci',
		failedChecks: ['typecheck'],
		state: { ciFixes: 1, feedbackRounds: 0, revising: { since: LATER, reason: 'ci' } },
	});
});

test('a second CI failure halts automation', () => {
	const state = { ...INITIAL_STATE, ciFixes: LIMITS.ciFixes };
	const next = decideNext(state, obs({ ci: 'failure', failedChecks: ['test'] }));
	assert.equal(next.action, 'halt');
});

test('while a revision is in flight, nothing else happens', () => {
	const state: BotState = { ...INITIAL_STATE, ciFixes: 1, revising: { since: LATER, reason: 'ci' } };
	const next = decideNext(state, obs({ ci: 'failure', now: '2026-10-31T10:45:00.000Z' }));
	assert.deepEqual(next, { action: 'wait' });
});

test('a push after the revision started clears the in-flight flag', () => {
	const state: BotState = { ...INITIAL_STATE, ciFixes: 1, revising: { since: PUSH, reason: 'ci' } };
	const next = decideNext(state, obs({ ci: 'pending', lastPush: LATER, now: LATER }));
	assert.deepEqual(next, { action: 'save', state: { ...INITIAL_STATE, ciFixes: 1 } });
});

test('a revision that never pushes halts after the timeout', () => {
	const state: BotState = { ...INITIAL_STATE, revising: { since: PUSH, reason: 'feedback' } };
	const now = new Date(Date.parse(PUSH) + LIMITS.revisionTimeoutMs + 1).toISOString();
	assert.equal(decideNext(state, obs({ now })).action, 'halt');
});

test('approver feedback from Asana or the PR triggers a revision', () => {
	const asana = decideNext(INITIAL_STATE, obs({ approval: { status: 'changes_requested', feedback: ['rename it'] } }));
	assert.deepEqual(asana, {
		action: 'revise',
		feedback: ['rename it'],
		state: { ciFixes: 0, feedbackRounds: 1, revising: { since: LATER, reason: 'feedback' } },
	});
	const pr = decideNext(INITIAL_STATE, obs({ prFeedback: ['add a test'] }));
	assert.equal(pr.action, 'revise');
});

test('feedback from both places is combined', () => {
	const next = decideNext(
		INITIAL_STATE,
		obs({ approval: { status: 'changes_requested', feedback: ['a'] }, prFeedback: ['b'] }),
	);
	assert.deepEqual(next.action === 'revise' && next.feedback, ['a', 'b']);
});

test('feedback beyond the round limit halts automation', () => {
	const state = { ...INITIAL_STATE, feedbackRounds: LIMITS.feedbackRounds };
	assert.equal(decideNext(state, obs({ prFeedback: ['again'] })).action, 'halt');
});

test('feedback is handled even before CI is green, but not while CI runs', () => {
	assert.equal(decideNext(INITIAL_STATE, obs({ ci: 'pending', prFeedback: ['x'] })).action, 'wait');
});

test('PR feedback outranks an Asana approval', () => {
	const next = decideNext(INITIAL_STATE, obs({ approval: { status: 'approved', approverGid: '1' }, prFeedback: ['wait'] }));
	assert.equal(next.action, 'revise');
});

test('merges when approved, CI green and no outstanding feedback', () => {
	const next = decideNext(INITIAL_STATE, obs({ approval: { status: 'approved', approverGid: '1' } }));
	assert.deepEqual(next, { action: 'merge', approverGid: '1' });
});

test('halted PRs are left alone', () => {
	const state: BotState = { ...INITIAL_STATE, halted: 'CI failed twice' };
	assert.deepEqual(decideNext(state, obs({ prFeedback: ['please'] })), { action: 'wait' });
});
