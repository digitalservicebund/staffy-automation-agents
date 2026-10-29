import { createSign } from 'node:crypto';
import type { CheckRun } from '../review.ts';

const API = 'https://api.github.com';
export const STAFFY_REPO = 'digitalservicebund/staffy';

// Installation tokens live for an hour; refresh a minute early.
const EXPIRY_MARGIN_MS = 60_000;
let cached: { token: string; expiresAt: number } | undefined;

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
	const installation = (await (await githubFetch(`/repos/${STAFFY_REPO}/installation`, jwt)).json()) as { id: number };
	const res = await githubFetch(`/app/installations/${installation.id}/access_tokens`, jwt, { method: 'POST' });
	const body = (await res.json()) as { token: string; expires_at: string };
	cached = { token: body.token, expiresAt: Date.parse(body.expires_at) - EXPIRY_MARGIN_MS };
	return cached.token;
}

async function staffy<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await githubFetch(`/repos/${STAFFY_REPO}${path}`, await installationToken(), init);
	return (await res.json()) as T;
}

export type PullRequest = { number: number; state: 'open' | 'closed'; merged: boolean; head: { sha: string } };

export const getPr = (number: number) => staffy<PullRequest>(`/pulls/${number}`);

export async function checkRuns(sha: string): Promise<CheckRun[]> {
	return (await staffy<{ check_runs: CheckRun[] }>(`/commits/${sha}/check-runs?per_page=100`)).check_runs;
}

// When the head commit landed. Only Staffy Bot pushes to its fix branches,
// so the committer date is a trustworthy "last push" for stale-approval checks.
export async function headCommittedAt(sha: string): Promise<string> {
	return (await staffy<{ commit: { committer: { date: string } } }>(`/commits/${sha}`)).commit.committer.date;
}

export async function commentOnPr(number: number, body: string): Promise<void> {
	await staffy(`/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
}

// Pinning `sha` makes GitHub refuse the merge if anything was pushed after
// the approval was evaluated.
export async function mergePr(number: number, sha: string): Promise<void> {
	await staffy(`/pulls/${number}/merge`, { method: 'PUT', body: JSON.stringify({ sha, merge_method: 'squash' }) });
}
