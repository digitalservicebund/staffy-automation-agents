import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTokenBudget } from './budget.ts';

test('accumulates input and output tokens across turns', () => {
	const budget = createTokenBudget(1000);
	assert.equal(budget.add({ input: 300, output: 50 }), false);
	assert.equal(budget.add({ input: 400, output: 100 }), false);
	assert.equal(budget.used(), 850);
});

test('reports exceeded once the total passes the limit, and stays exceeded', () => {
	const budget = createTokenBudget(1000);
	budget.add({ input: 900, output: 50 });
	assert.equal(budget.add({ input: 100, output: 0 }), true);
	assert.equal(budget.add({ input: 0, output: 0 }), true);
});

test('ignores missing usage', () => {
	const budget = createTokenBudget(1000);
	assert.equal(budget.add(undefined), false);
	assert.equal(budget.used(), 0);
});
