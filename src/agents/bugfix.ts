'use agent';
import '../providers/stackit.ts';
import { useMcpConnection, useModel } from '@flue/runtime';
import { asana } from '../connections/asana.ts';

// Board and approvers come from env (1Password) so no IDs or PII live in code.
const projectGid = process.env.ASANA_BUG_PROJECT_GID;
if (!projectGid) throw new Error('ASANA_BUG_PROJECT_GID is not set');

// Picks up a bug ticket from Asana, fixes it in ds-staffing, opens a PR, and
// keeps the ticket updated. GitHub tools and the approval gate land next.
export function Bugfix() {
	useModel('stackit/google/gemma-4-31B-it');
	// Asana exposes ~50 tools; mount only what triage needs (no delete, no project edits).
	useMcpConnection({
		...asana,
		tools: ['get_project', 'get_tasks', 'search_tasks', 'get_task', 'get_task_stories', 'update_tasks', 'add_comment', 'get_user'],
	});
	return [
		'You fix bugs in Staffy, a Nuxt 4 + Prisma staffing app.',
		`Bug tickets live in Asana project ${projectGid}.`,
		'Follow the rules in the repository AGENTS.md.',
		'Keep fixes minimal, add a failing test first, and explain the root cause.',
	].join('\n');
}
