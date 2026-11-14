import { createSign } from 'node:crypto';
import type { CheckRun, PrFeedbackItem } from '../review.ts';

const API = 'https://api.github.com';
export const STAFFY_REPO = 'digitalservicebund/staffy';

export const prUrl = (number: number) => `https://github.com/${STAFFY_REPO}/pull/${number}`;

// Installation tokens live for an hour; refresh a minute early.
const EXPIRY_MARGIN_MS = 60_000;
let cached: { token: string; expiresAt: number; appSlug: string } | undefined;

function base64url(value: string | Buffer): string {
	return Buffer.from(value).toString('base64url');
}

// App JWT (RS256), valid 9 minutes and backdated 60s for clock drift, per GitHub's guidance.
function appJwt(clientId: string, privateKey: string): string {
	const now = Math.floor(Date.now() / 1000);
	const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
	const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: clientId }));
	const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey);
	return `${header}.${payload}.${base64url(signature)}`;
}

async function githubFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
	const res = await fetch(`${API}${path}`, {
		...init,
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...init.headers },
	});
	if (!res.ok) throw new Error(`GitHub ${init.method ?? 'GET'} ${path} failed: ${res.status}`);
	return res;
}

// Installation token for Staffy Bot on the staffy repo.
export async function installationToken(): Promise<string> {
	if (cached && Date.now() < cached.expiresAt) return cached.token;
	const { GITHUB_APP_CLIENT_ID, GITHUB_APP_PRIVATE_KEY } = process.env;
	if (!GITHUB_APP_CLIENT_ID || !GITHUB_APP_PRIVATE_KEY) {
		throw new Error('GitHub App credentials are not set — see .env.schema');
	}
	const jwt = appJwt(GITHUB_APP_CLIENT_ID, GITHUB_APP_PRIVATE_KEY);
	const installation = (await (await githubFetch(`/repos/${STAFFY_REPO}/installation`, jwt)).json()) as { id: number; app_slug: string };
	const res = await githubFetch(`/app/installations/${installation.id}/access_tokens`, jwt, { method: 'POST' });
	const body = (await res.json()) as { token: string; expires_at: string };
	cached = { token: body.token, expiresAt: Date.parse(body.expires_at) - EXPIRY_MARGIN_MS, appSlug: installation.app_slug };
	return cached.token;
}

async function staffy<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await githubFetch(`/repos/${STAFFY_REPO}${path}`, await installationToken(), init);
	return (await res.json()) as T;
}

export type PullRequest = {
	number: number;
	state: 'open' | 'closed';
	merged: boolean;
	title: string;
	body: string | null;
	head: { sha: string };
};

export const getPr = (number: number) => staffy<PullRequest>(`/pulls/${number}`);

export async function checkRuns(sha: string): Promise<CheckRun[]> {
	return (await staffy<{ check_runs: CheckRun[] }>(`/commits/${sha}/check-runs?per_page=100`)).check_runs;
}

// When the head commit landed. Only Staffy Bot pushes to its fix branches,
// so the committer date is a trustworthy "last push" for stale-approval checks.
export async function headCommittedAt(sha: string): Promise<string> {
	return (await staffy<{ commit: { committer: { date: string } } }>(`/commits/${sha}`)).commit.committer.date;
}

// Reuses the open PR for `branch` if there is one (a revision push), else opens it.
export async function openPr(branch: string, title: string, body: string): Promise<number> {
	const owner = STAFFY_REPO.split('/')[0];
	const [existing] = await staffy<PullRequest[]>(`/pulls?state=open&head=${owner}:${encodeURIComponent(branch)}`);
	if (existing) return existing.number;
	const pr = await staffy<PullRequest>('/pulls', { method: 'POST', body: JSON.stringify({ head: branch, base: 'main', title, body }) });
	return pr.number;
}

export async function commentOnPr(number: number, body: string): Promise<number> {
	return (await staffy<{ id: number }>(`/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) })).id;
}

// Pinning `sha` makes GitHub refuse the merge if anything was pushed after
// the approval was evaluated.
export async function mergePr(number: number, sha: string): Promise<void> {
	await staffy(`/pulls/${number}/merge`, { method: 'PUT', body: JSON.stringify({ sha, merge_method: 'squash' }) });
}

export async function findOpenPr(branch: string): Promise<PullRequest | undefined> {
	const owner = STAFFY_REPO.split('/')[0];
	const [pr] = await staffy<PullRequest[]>(`/pulls?state=open&head=${owner}:${encodeURIComponent(branch)}`);
	return pr;
}

const LOG_TAIL_LINES = 120;

// Tail of each failing GitHub Actions job's log, for the coder's CI-fix brief.
export async function failedCheckLogs(runs: readonly CheckRun[]): Promise<string> {
	const failed = runs.filter((r) => r.status === 'completed' && !['success', 'skipped', 'neutral'].includes(r.conclusion ?? ''));
	const parts = await Promise.all(
		failed.map(async (r) => {
			if (r.app?.slug !== 'github-actions' || r.id === undefined) return `## ${r.name}\n(no log available)`;
			const res = await githubFetch(`/repos/${STAFFY_REPO}/actions/jobs/${r.id}/logs`, await installationToken());
			const tail = (await res.text()).split('\n').slice(-LOG_TAIL_LINES).join('\n');
			return `## ${r.name}\n${tail}`;
		}),
	);
	return parts.join('\n\n');
}

type Authored = { user: { login: string } | null; body: string | null };

// Issue comments, reviews and inline review comments on the PR, flattened.
export async function prFeedbackItems(number: number): Promise<PrFeedbackItem[]> {
	const [comments, reviews, inline] = await Promise.all([
		staffy<(Authored & { created_at: string })[]>(`/issues/${number}/comments?per_page=100`),
		staffy<(Authored & { submitted_at: string })[]>(`/pulls/${number}/reviews?per_page=100`),
		staffy<(Authored & { created_at: string; path: string })[]>(`/pulls/${number}/comments?per_page=100`),
	]);
	const item = (a: Authored, createdAt: string, prefix = '') => ({ author: a.user?.login ?? '', createdAt, body: a.body ? `${prefix}${a.body}` : '' });
	return [
		...comments.map((c) => item(c, c.created_at)),
		...reviews.map((r) => item(r, r.submitted_at)),
		...inline.map((c) => item(c, c.created_at, `(on ${c.path}) `)),
	];
}

const STATE_TAG = '<!-- staffy-bot-state ';

// The bot's state lives in one bot-authored PR comment, edited in place.
export async function readBotState(number: number): Promise<{ commentId?: number; body: string }> {
	const comments = await staffy<{ id: number; body: string; performed_via_github_app: { slug: string } | null }[]>(
		`/issues/${number}/comments?per_page=100`,
	);
	const slug = await appSlug();
	const mine = comments.find((c) => c.performed_via_github_app?.slug === slug && c.body.includes(STATE_TAG));
	return { commentId: mine?.id, body: mine?.body ?? '' };
}

// Returns the state comment id, so later writes in the same run edit it.
export async function writeBotState(number: number, commentId: number | undefined, body: string): Promise<number> {
	if (commentId === undefined) return commentOnPr(number, body);
	await staffy(`/issues/comments/${commentId}`, { method: 'PATCH', body: JSON.stringify({ body }) });
	return commentId;
}

// Slug of this GitHub App, e.g. for recognising its own comments.
export async function appSlug(): Promise<string> {
	await installationToken();
	return cached!.appSlug; // set by installationToken() above
}
