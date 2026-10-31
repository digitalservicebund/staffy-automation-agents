import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { BOT_MARK } from '../approval.ts';
import { connectAsana } from '../connections/asana-client.ts';
import { findOpenPr, openPr, prUrl } from '../connections/github.ts';
import { fixBranch } from '../review.ts';
import { commitAndPush, hasChanges } from '../workspace.ts';

// The model decides *what* to submit; this code decides *how*: it alone holds
// the GitHub and Asana credentials and pushes as Staffy Bot. The review
// subtask is created later by the bot sweep, once CI on the PR is green.
export const submitFix = defineTool({
	name: 'submit_fix',
	description:
		'Commit the current changes in the staffy checkout and push them as Staffy Bot: opens the PR on the first ' +
		'submission, or adds a commit to the existing PR when revising. Call once the coder reports passing tests.',
	input: v.object({
		ticketGid: v.pipe(v.string(), v.description('GID of the Asana bug ticket being fixed.')),
		title: v.pipe(v.string(), v.minLength(5), v.maxLength(72), v.description('Commit/PR title, conventional-commit style, e.g. "fix(people): ..."')),
		summary: v.pipe(
			v.string(),
			v.minLength(20),
			v.description('Root cause, the change, and the tests run. Becomes the PR body (first submission) or commit body (revision).'),
		),
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
			const existing = await findOpenPr(branch);
			await commitAndPush(branch, `${data.title}\n\n${data.summary}`);
			const pr = existing?.number ?? (await openPr(branch, data.title, data.summary));
			const message = existing
				? `${BOT_MARK} Staffy Bot pushed a revision to ${prUrl(pr)}:\n\n${data.summary}`
				: `${BOT_MARK} Staffy Bot opened a PR: ${prUrl(pr)}\n\nWaiting for checks to pass before requesting review.`;
			await asana.comment(data.ticketGid, message);
			return existing ? `Pushed a revision to staffy#${pr}.` : `Opened staffy#${pr}; checks are running.`;
		} finally {
			await asana.close();
		}
	},
});
