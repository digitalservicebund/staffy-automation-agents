'use agent';
import '../providers/stackit.ts';
import { useModel } from '@flue/runtime';

// Picks up a bug ticket from Asana, fixes it in ds-staffing, opens a PR, and
// keeps the ticket updated. Tools (Asana, GitHub, approval gate) land next.
export function Bugfix() {
	useModel('stackit/google/gemma-4-31B-it');
	return [
		'You fix bugs in Staffy, a Nuxt 4 + Prisma staffing app.',
		'Follow the rules in the repository AGENTS.md.',
		'Keep fixes minimal, add a failing test first, and explain the root cause.',
	].join('\n');
}
