// Deterministic review loop — no model involved. For every ticket in "Ready
// for Review", reads its "Review: staffy#N" subtask and merges the PRs once an
// allowlisted approver has completed the subtask after the last push and CI
// is green, then moves the ticket to "Complete".
//
// Dry run by default; pass --apply to comment, merge and move tickets.
import { evaluateApproval } from '../src/approval.ts';
import { connectAsana, type AsanaClient } from '../src/connections/asana-client.ts';
import { checkRuns, commentOnPr, getPr, headCommittedAt, mergePr, prUrl, type PullRequest } from '../src/connections/github.ts';
import { ciState, decideReview, parseReviewPrs, type CiState } from '../src/review.ts';

const READY_SECTION = 'Ready for Review';
const DONE_SECTION = 'Complete';

const apply = process.argv.includes('--apply');
const projectGid = process.env.ASANA_BUG_PROJECT_GID;
const approverGids = (process.env.ASANA_APPROVER_GIDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
if (!projectGid || approverGids.length === 0) throw new Error('ASANA_BUG_PROJECT_GID / ASANA_APPROVER_GIDS are not set');

// Worst state wins: any failure fails, any pending waits.
function combineCi(states: CiState[]): CiState {
	if (states.includes('failure')) return 'failure';
	return states.includes('pending') ? 'pending' : 'success';
}

async function loadPrs(numbers: number[]) {
	const prs = await Promise.all(numbers.map(getPr));
	const open = prs.filter((pr) => pr.state === 'open');
	const pushTimes = await Promise.all(open.map((pr) => headCommittedAt(pr.head.sha)));
	const ci = combineCi(await Promise.all(open.map(async (pr) => ciState(await checkRuns(pr.head.sha)))));
	const lastPush = pushTimes.sort().at(-1) ?? new Date(0).toISOString();
	const abandoned = prs.some((pr) => pr.state === 'closed' && !pr.merged);
	return { open, ci, lastPush, abandoned };
}

async function merge(asana: AsanaClient, ticketGid: string, subtaskGid: string, open: PullRequest[], doneGid: string) {
	const approvalLink = `https://app.asana.com/0/0/${subtaskGid}`;
	for (const pr of open) {
		await commentOnPr(pr.number, `Approved in Asana: ${approvalLink}\n\nMerging as Staffy Bot.`);
		await mergePr(pr.number, pr.head.sha);
	}
	await asana.moveToSection(ticketGid, projectGid!, doneGid); // checked non-empty at startup
	await asana.comment(ticketGid, `Merged after approval:\n${open.map((pr) => prUrl(pr.number)).join('\n')}`);
}

async function sweepTicket(asana: AsanaClient, ticket: { gid: string; name: string }, doneGid: string) {
	for (const subtask of await asana.subtasks(ticket.gid)) {
		const prNumbers = parseReviewPrs(subtask.name);
		if (prNumbers.length === 0) continue;

		const { open, ci, lastPush, abandoned } = await loadPrs(prNumbers);
		if (abandoned || open.length === 0) {
			console.log(`${ticket.gid}: skipped (${abandoned ? 'a PR was closed unmerged' : 'nothing open'})`);
			continue;
		}
		const approval = evaluateApproval(await asana.stories(subtask.gid, lastPush), { approverGids, since: lastPush });
		const decision = decideReview(approval, ci);
		console.log(`${ticket.gid}: ${decision.action}${apply ? '' : ' (dry run)'}`);
		if (decision.action === 'merge' && apply) await merge(asana, ticket.gid, subtask.gid, open, doneGid);
	}
}

const asana = await connectAsana();
try {
	const readyGid = await asana.sectionGid(projectGid, READY_SECTION);
	const doneGid = await asana.sectionGid(projectGid, DONE_SECTION);
	const tickets = await asana.tasksInSection(readyGid);
	for (const ticket of tickets) await sweepTicket(asana, ticket, doneGid);
	console.log(`Checked ${tickets.length} ticket(s) in "${READY_SECTION}"${apply ? "" : " (dry run)"}.`);
} finally {
	await asana.close();
}
