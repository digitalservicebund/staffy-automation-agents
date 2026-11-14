// Deterministic driver for every open bot PR — no model decides anything here.
// For each ticket in "In Progress" / "Ready for Review" with an open
// bot/asana-<gid> PR, it observes CI, feedback and approval, asks the pure
// state machine (src/lifecycle.ts) what to do, and does it: create the review
// subtask once green, dispatch a CI fix or feedback revision to the agent,
// merge on approval, or halt at a hard limit. Significant steps are reported
// on the Asana ticket.
//
// Dry run by default; pass --apply to act. At most one agent revision is
// dispatched per run.
import { BOT_MARK, evaluateApproval } from '../src/approval.ts';
import { connectAsana, type AsanaClient } from '../src/connections/asana-client.ts';
import {
	checkRuns,
	commentOnPr,
	failedCheckLogs,
	findOpenPr,
	headCommittedAt,
	mergePr,
	prFeedbackItems,
	prUrl,
	readBotState,
	writeBotState,
	type PullRequest,
} from '../src/connections/github.ts';
import { decideNext, LIMITS, parseState, recordBudgetExceeded, recordDispatchFailure, serializeState, unstick, type BotState, type Decision } from '../src/lifecycle.ts';
import { ciState, fixBranch, parseReviewPrs, reviewSubtaskName, selectPrFeedback, type CheckRun } from '../src/review.ts';
import { canRunAgent, RunLimitHit, runBugfixAgent } from '../src/run-agent.ts';
import { buildRevisionMessage } from '../src/revision.ts';
import { branchDiff, prepareCheckout } from '../src/workspace.ts';

const ACTIVE_SECTIONS = ['In Progress', 'Ready for Review'];
const READY_SECTION = 'Ready for Review';
const DONE_SECTION = 'Complete';
const MAX_DISPATCHES_PER_RUN = 1;

const apply = process.argv.includes('--apply');
// `--unstick <pr>`: clear a stuck revision or halt on one PR (refunding the in-flight attempt), then exit.
const unstickIndex = process.argv.indexOf('--unstick');
const unstickPr = unstickIndex === -1 ? undefined : Number(process.argv[unstickIndex + 1]);
const canDispatch = canRunAgent();
const env = (name: string) => (process.env[name] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const projectGid = process.env.ASANA_BUG_PROJECT_GID ?? '';
const approverGids = env('ASANA_APPROVER_GIDS');
const approverLogins = env('GITHUB_APPROVER_LOGINS');
if (!projectGid || approverGids.length === 0 || approverLogins.length === 0) {
	throw new Error('ASANA_BUG_PROJECT_GID / ASANA_APPROVER_GIDS / GITHUB_APPROVER_LOGINS are not set');
}

type Ticket = { gid: string; name: string };
type Context = { asana: AsanaClient; ticket: Ticket; pr: PullRequest; runs: CheckRun[]; stateCommentId?: number; state: BotState };
let dispatched = 0;

// Timestamped progress line, so a long sweep is never silent.
const log = (message: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);

async function observe(asana: AsanaClient, ticket: Ticket, pr: PullRequest) {
	const sha = pr.head.sha;
	const [runs, lastPush, stateComment, subtasks, items] = await Promise.all([
		checkRuns(sha),
		headCommittedAt(sha),
		readBotState(pr.number),
		asana.subtasks(ticket.gid),
		prFeedbackItems(pr.number),
	]);
	const reviewSubtask = subtasks.find((s) => parseReviewPrs(s.name).includes(pr.number));
	const opts = { approverGids, since: lastPush };
	const approval = reviewSubtask ? evaluateApproval(await asana.stories(reviewSubtask.gid, lastPush), opts) : { status: 'pending' as const };
	// Approver comments on the main ticket count as feedback, never as approval.
	const ticketComments = (await asana.stories(ticket.gid, lastPush)).filter((s) => s.resource_subtype === 'comment_added');
	const ticketVerdict = evaluateApproval(ticketComments, opts);
	const feedback = [
		...(ticketVerdict.status === 'changes_requested' ? ticketVerdict.feedback : []),
		...selectPrFeedback(items, { logins: approverLogins, since: lastPush }),
	];
	const state = parseState(stateComment.body);
	const observation = {
		ci: ciState(runs),
		failedChecks: runs.filter((r) => ciState([r]) === 'failure').map((r) => r.name ?? 'unnamed check'),
		hasReviewSubtask: reviewSubtask !== undefined,
		approval,
		prFeedback: feedback,
		lastPush,
		now: new Date().toISOString(),
	};
	return { runs, state, stateCommentId: stateComment.commentId, reviewSubtask, observation };
}

async function saveState(ctx: Context, state: BotState) {
	const body = `Staffy Bot automation state — edited automatically, please don't change.\n\n${serializeState(state)}`;
	ctx.stateCommentId = await writeBotState(ctx.pr.number, ctx.stateCommentId, body);
	ctx.state = state;
}

// Comments on the Asana ticket and echoes it locally, so the console mirrors what the team sees.
async function say(ctx: Context, text: string) {
	log(`${ctx.ticket.gid} → Asana: ${text.split('\n')[0]}`);
	await ctx.asana.comment(ctx.ticket.gid, `${BOT_MARK} ${text}`);
}

// Runs the agent on the existing PR branch; its own tools push the result. If
// the run fails, the attempt is refunded and the PR unlocked (repeated
// failures halt), instead of waiting out the revision timeout.
async function dispatchRevision(ctx: Context, brief: string) {
	try {
		await runAgent(ctx, brief);
	} catch (err) {
		if (err instanceof RunLimitHit) {
			await saveState(ctx, recordBudgetExceeded(ctx.state, err.message));
			const url = prUrl(ctx.pr.number);
			await commentOnPr(ctx.pr.number, `Staffy Bot stopped automating this PR: ${err.message}. A human needs to take over.`);
			return say(ctx, `Automation stopped on ${url}: ${err.message}. A human needs to take over.`);
		}
		const error = err instanceof Error ? err.message.split('\n')[0] : String(err);
		const next = recordDispatchFailure(ctx.state, error);
		await saveState(ctx, next);
		const outcome = next.halted ? `Automation stopped: ${next.halted}. A human needs to take over.` : 'The attempt was not counted; the next sweep will retry.';
		await say(ctx, `The automated revision of ${prUrl(ctx.pr.number)} failed to run (${error}). ${outcome}`);
	}
}

async function runAgent(ctx: Context, brief: string) {
	log(`staffy#${ctx.pr.number}: preparing checkout of ${fixBranch(ctx.ticket.gid)} (git fetch + npm ci)…`);
	await prepareCheckout(fixBranch(ctx.ticket.gid));
	log(`staffy#${ctx.pr.number}: starting agent (timeout ${LIMITS.agentRunMs / 60_000} min); its activity follows`);
	const message = buildRevisionMessage({
		prUrl: prUrl(ctx.pr.number),
		ticketGid: ctx.ticket.gid,
		ticket: await ctx.asana.taskDetails(ctx.ticket.gid),
		pr: { title: ctx.pr.title, body: ctx.pr.body ?? '' },
		diff: await branchDiff(),
		brief,
	});
	await runBugfixAgent(ctx.ticket.gid, message);
	log(`staffy#${ctx.pr.number}: agent finished`);
}

async function createReview(ctx: Context) {
	const url = prUrl(ctx.pr.number);
	const notes = `PR: ${url}\n\nChecks are green. Mark this subtask complete to approve and merge. Comment here (or on the PR) to request changes.`;
	await ctx.asana.createSubtask(ctx.ticket.gid, reviewSubtaskName([ctx.pr.number]), notes);
	await ctx.asana.moveToSection(ctx.ticket.gid, projectGid, await ctx.asana.sectionGid(projectGid, READY_SECTION));
	await say(ctx, `Checks passed on ${url}. Review requested: mark "${reviewSubtaskName([ctx.pr.number])}" complete to approve.`);
}

async function merge(ctx: Context) {
	await commentOnPr(ctx.pr.number, `Approved in Asana: https://app.asana.com/0/0/${ctx.ticket.gid}\n\nMerging as Staffy Bot.`);
	await mergePr(ctx.pr.number, ctx.pr.head.sha);
	await ctx.asana.moveToSection(ctx.ticket.gid, projectGid, await ctx.asana.sectionGid(projectGid, DONE_SECTION));
	await say(ctx, `Merged after approval:\n${prUrl(ctx.pr.number)}`);
}

async function act(ctx: Context, decision: Decision) {
	const url = prUrl(ctx.pr.number);
	switch (decision.action) {
		case 'wait':
			return;
		case 'save':
			return saveState(ctx, decision.state);
		case 'create_review':
			return createReview(ctx);
		case 'merge':
			return merge(ctx);
		case 'halt':
			await saveState(ctx, decision.state);
			await commentOnPr(ctx.pr.number, `Staffy Bot stopped automating this PR: ${decision.reason}. A human needs to take over.`);
			return say(ctx, `Automation stopped on ${url}: ${decision.reason}. A human needs to take over.`);
		case 'fix_ci':
			// Persist the attempt before dispatching, so a crash can't cause a second one.
			await saveState(ctx, decision.state);
			await say(ctx, `Checks failed on ${url} (${decision.failedChecks.join(', ')}). Submitting an automated fix (attempt ${decision.state.ciFixes} of ${LIMITS.ciFixes}).`);
			return dispatchRevision(ctx, [`CI failed. Failing checks and log tails:\n\n${await failedCheckLogs(ctx.runs)}`, feedbackBrief(decision.feedback)].join('\n\n'));
		case 'revise':
			await saveState(ctx, decision.state);
			await say(ctx, `Revising ${url} based on reviewer feedback (round ${decision.state.feedbackRounds} of ${LIMITS.feedbackRounds}).`);
			return dispatchRevision(ctx, feedbackBrief(decision.feedback));
	}
}

function feedbackBrief(feedback: string[]): string {
	return feedback.length === 0 ? '' : `Reviewer feedback:\n\n${feedback.map((f) => `- ${f}`).join('\n')}`;
}

async function sweepTicket(asana: AsanaClient, ticket: Ticket) {
	const pr = await findOpenPr(fixBranch(ticket.gid));
	if (!pr) return;
	const { runs, state, stateCommentId, observation } = await observe(asana, ticket, pr);
	const decision = decideNext(state, observation);
	const needsAgent = decision.action === 'fix_ci' || decision.action === 'revise';
	const deferral = !needsAgent ? '' : !canDispatch ? 'agent not allowed on this host; set ALLOW_LOCAL_SANDBOX=true' : dispatched >= MAX_DISPATCHES_PER_RUN ? 'one agent run per sweep' : '';
	log(`${ticket.gid} staffy#${pr.number}: ${decision.action}${deferral ? ` (deferred: ${deferral})` : ''}${apply ? '' : ' (dry run)'}`);
	if (!apply || deferral) return;
	if (needsAgent) dispatched++;
	await act({ asana, ticket, pr, runs, stateCommentId, state }, decision);
}

async function unstickPullRequest(number: number) {
	const { commentId, body } = await readBotState(number);
	if (commentId === undefined) throw new Error(`staffy#${number} has no Staffy Bot state comment`);
	const next = unstick(parseState(body));
	await writeBotState(number, commentId, `Staffy Bot automation state — edited automatically, please don't change.\n\n${serializeState(next)}`);
	log(`staffy#${number} unstuck: ${JSON.stringify(next)}`);
}

if (unstickPr !== undefined) {
	if (!Number.isInteger(unstickPr) || unstickPr <= 0) throw new Error('Usage: --unstick <PR number>');
	await unstickPullRequest(unstickPr);
	process.exit(0);
}

const asana = await connectAsana();
try {
	let checked = 0;
	for (const section of ACTIVE_SECTIONS) {
		const tickets = await asana.tasksInSection(await asana.sectionGid(projectGid, section));
		log(`${section}: ${tickets.length} ticket(s)`);
		for (const ticket of tickets) {
			// One ticket's failure (e.g. a transient API error) must not stop the others.
			await sweepTicket(asana, ticket).catch((err: unknown) => console.error(`${ticket.gid}: ${String(err)}`));
		}
		checked += tickets.length;
	}
	log(`Checked ${checked} ticket(s)${apply ? '' : ' (dry run)'}.`);
} finally {
	await asana.close();
}
