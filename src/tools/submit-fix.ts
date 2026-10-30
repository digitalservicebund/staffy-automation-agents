import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { connectAsana } from '../connections/asana-client.ts';
import { openPr, prUrl } from '../connections/github.ts';
import { fixBranch, parseReviewPrs, reviewSubtaskName } from '../review.ts';
import { commitAndPush, hasChanges } from '../workspace.ts';

const READY_SECTION = 'Ready for Review';

// The model decides *what* to submit; this code decides *how*: it alone holds
// the GitHub and Asana credentials, pushes as Staffy Bot, and creates the
// review subtask the review sweep later reads.
export const submitFix = defineTool({
	name: 'submit_fix',
	description:
		'Commit the current changes in the staffy checkout, push them as Staffy Bot, open (or update) the PR, ' +
		'add a "Review: staffy#N" subtask to the ticket, and move the ticket to "Ready for Review". ' +
		'Call once the coder reports passing tests.',
	input: v.object({
		ticketGid: v.pipe(v.string(), v.description('GID of the Asana bug ticket being fixed.')),
		title: v.pipe(v.string(), v.minLength(5), v.maxLength(72), v.description('PR title, conventional-commit style, e.g. "fix(people): ..."')),
		summary: v.pipe(v.string(), v.minLength(20), v.description('Root cause, the fix, and the tests run. Becomes the PR body.')),
	}),

	async run({ data }) {
		const projectGid = process.env.ASANA_BUG_PROJECT_GID;
		if (!projectGid) throw new Error('ASANA_BUG_PROJECT_GID is not set');
		const branch = fixBranch(data.ticketGid);
		if (!(await hasChanges())) return 'Nothing to submit: the checkout has no changes.';

		const asana = await connectAsana();
		try {
			if (!(await asana.isTaskInProject(data.ticketGid, projectGid))) {
				return `Ticket ${data.ticketGid} is not on the bug board; nothing was pushed.`;
			}
			await commitAndPush(branch, `${data.title}\n\n${data.summary}`);
			const pr = await openPr(branch, data.title, data.summary);

			const subtasks = await asana.subtasks(data.ticketGid);
			if (!subtasks.some((s) => parseReviewPrs(s.name).includes(pr))) {
				const notes = `PR: ${prUrl(pr)}\n\nMark this subtask complete to approve and merge. Comment here to request changes.\n\n${data.summary}`;
				await asana.createSubtask(data.ticketGid, reviewSubtaskName([pr]), notes);
			}
			await asana.moveToSection(data.ticketGid, projectGid, await asana.sectionGid(projectGid, READY_SECTION));
			await asana.comment(data.ticketGid, `Staffy Bot opened a PR for review: ${prUrl(pr)}\n\nMark the "Review: staffy#${pr}" subtask complete to approve and merge.`);
			return `Submitted staffy#${pr}; ticket moved to "${READY_SECTION}".`;
		} finally {
			await asana.close();
		}
	},
});
