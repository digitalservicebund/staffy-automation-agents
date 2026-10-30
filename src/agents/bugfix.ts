'use agent';
import { CODING_MODEL, TRIAGE_MODEL } from '../providers/stackit.ts';
import { useMcpConnection, useModel, useSandbox, useSubagent, useTool } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import { asana } from '../connections/asana.ts';
import { submitFix } from '../tools/submit-fix.ts';
import { WORKDIR } from '../workspace.ts';

// Board and approvers come from env (1Password) so no IDs or PII live in code.
const projectGid = process.env.ASANA_BUG_PROJECT_GID;
if (!projectGid) throw new Error('ASANA_BUG_PROJECT_GID is not set');

// local() runs model-directed shell commands as real host processes. That's
// fine on a throwaway CI runner; on a laptop it must be an explicit choice.
if (!process.env.CI && process.env.ALLOW_LOCAL_SANDBOX !== 'true') {
	throw new Error('Refusing to run model shell commands on this host: set ALLOW_LOCAL_SANDBOX=true (or run in CI).');
}

// Code-editing delegate on the coding model. Gets no Asana or GitHub access:
// it only sees the brief it is handed and the staffy checkout (via the shared sandbox).
function Coder() {
	return [
		'You fix one bug in Staffy, a Nuxt 4 + Prisma staffing app, from a self-contained brief.',
		'You are in a clean checkout of the staffy repository. Follow its AGENTS.md.',
		'Write a failing test first, make the minimal fix, then run the relevant test files and `npm run typecheck`.',
		'Do not commit, push, or touch git; leave your changes in the working tree.',
		'Reply with the root cause, the files changed, and the exact test results.',
	].join('\n');
}

// Triages a bug ticket from Asana and keeps it updated; delegates the code
// change to `coder`, then submits it for review with `submit_fix`.
export function Bugfix() {
	useModel(TRIAGE_MODEL);
	// No secrets in the model's shell: local() passes only PATH/HOME-style essentials.
	useSandbox(local({ cwd: WORKDIR }));
	// Asana exposes ~50 tools; mount only what triage needs (no delete, no project edits).
	useMcpConnection({
		...asana,
		tools: ['get_project', 'get_tasks', 'search_tasks', 'get_task', 'get_task_stories', 'update_tasks', 'add_comment', 'get_user'],
	});
	useSubagent({
		name: 'coder',
		description: 'Fixes one Staffy bug from a complete brief: failing test first, minimal fix, tests run.',
		agent: Coder,
		model: CODING_MODEL,
	});
	useTool(submitFix);
	return [
		'You triage bugs in Staffy, a Nuxt 4 + Prisma staffing app.',
		`Bug tickets live in Asana project ${projectGid}.`,
		'1. Read the ticket and its comments.',
		'2. Delegate the fix to the `coder` subagent with a complete brief:',
		'   reported behaviour, expected behaviour, reproduction steps, and relevant comments.',
		'3. If the coder reports passing tests, call `submit_fix` with the ticket GID, a conventional-commit PR title, and a summary.',
		'   If it could not fix the bug, comment on the ticket explaining why and stop.',
		'Do not write code yourself.',
	].join('\n');
}
