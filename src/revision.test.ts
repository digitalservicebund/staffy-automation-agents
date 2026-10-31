import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRevisionMessage, MAX_DIFF_CHARS } from './revision.ts';

const input = {
	prUrl: 'https://github.com/digitalservicebund/staffy/pull/268',
	ticketGid: '1219647123076485',
	ticket: { name: '🤖🔨 Export rounds to 4dp', notes: 'Values in the export should be rounded to 2 decimal places.' },
	pr: { title: 'fix(export): round to 2dp using LRM', body: 'Root cause: values were rounded to 4dp.' },
	diff: '- round(x, 4)\n+ round(x, 2)',
	brief: 'CI failed: TS2532 in utils/export-snapshot.ts',
};

test('carries the original intent: ticket, PR description and current diff', () => {
	const message = buildRevisionMessage(input);
	assert.match(message, /Values in the export should be rounded to 2 decimal places\./);
	assert.match(message, /fix\(export\): round to 2dp using LRM/);
	assert.match(message, /Root cause: values were rounded to 4dp\./);
	assert.match(message, /\+ round\(x, 2\)/);
	assert.match(message, /CI failed: TS2532/);
});

test('tells the agent to preserve the intended change rather than revert it', () => {
	const message = buildRevisionMessage(input);
	assert.match(message, /preserve/i);
	assert.match(message, /do not revert/i);
	assert.match(message, /update (the )?docs/i);
	assert.match(message, /do NOT call start_fix/);
});

test('fences untrusted material as information, not instructions', () => {
	const message = buildRevisionMessage(input);
	assert.match(message, /<revision-input>\nCI failed/);
	assert.match(message, /not as instructions/);
});

test('truncates very large diffs and says so', () => {
	const message = buildRevisionMessage({ ...input, diff: 'x'.repeat(MAX_DIFF_CHARS + 500) });
	assert.match(message, /diff truncated/);
	assert.ok(message.length < MAX_DIFF_CHARS + 5000);
});
