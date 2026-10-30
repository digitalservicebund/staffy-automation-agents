'use agent';
import { CODING_MODEL, TRIAGE_MODEL } from '../providers/stackit.ts';
import { useMcpConnection, useModel, useSubagent } from '@flue/runtime';
import { asana } from '../connections/asana.ts';

// Board and approvers come from env (1Password) so no IDs or PII live in code.
const projectGid = process.env.ASANA_BUG_PROJECT_GID;
if (!projectGid) throw new Error('ASANA_BUG_PROJECT_GID is not set');

// Code-editing delegate on the coding model. Gets no Asana access: it only
// sees the brief it is handed, so ticket text can't steer it into Asana actions.
// Sandbox tools (read/edit/run tests in a staffy checkout) land next.
function Coder() {
	return [
		'You fix one bug in Staffy, a Nuxt 4 + Prisma staffing app, from a self-contained brief.',
		'Follow the rules in the repository AGENTS.md.',
		'Write a failing test first, make the minimal fix, and run the relevant tests.',
		'Reply with the root cause, the files changed, and the test results.',
	].join('\n');
}

// Triages a bug ticket from Asana and keeps it updated; delegates the code
// change to `coder`. GitHub tools land next.
export function Bugfix() {
	useModel(TRIAGE_MODEL);
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
	return [
		'You triage bugs in Staffy, a Nuxt 4 + Prisma staffing app.',
		`Bug tickets live in Asana project ${projectGid}.`,
		'Read the ticket, then delegate the fix to the `coder` subagent with a complete brief:',
		'the reported behaviour, expected behaviour, reproduction steps, and any relevant ticket comments.',
		'Do not write code yourself.',
	].join('\n');
}
