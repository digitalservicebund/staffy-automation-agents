// The staffy checkout the coder works in. All git and GitHub-credentialed
// operations live here, in application code; the model's shell never holds a
// token and can't push.
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { installationToken, STAFFY_REPO } from './connections/github.ts';

const run = promisify(execFile);

export const WORKDIR = resolve(process.env.STAFFY_WORKDIR ?? '.work/staffy');
const REMOTE = `https://github.com/${STAFFY_REPO}.git`;
const BOT_NAME = 'staffy-bot[bot]';

// Per-command auth header, so the token is never written to .git/config.
async function authArgs(): Promise<string[]> {
	const basic = Buffer.from(`x-access-token:${await installationToken()}`).toString('base64');
	return ['-c', `http.extraHeader=Authorization: Basic ${basic}`];
}

async function git(args: string[], { auth = false, cwd = WORKDIR } = {}): Promise<string> {
	const { stdout } = await run('git', [...(auth ? await authArgs() : []), ...args], { cwd });
	return stdout.trim();
}

// Fresh, clean checkout of origin/main with dependencies installed.
export async function prepareCheckout(): Promise<void> {
	const exists = await git(['rev-parse', '--is-inside-work-tree']).catch(() => '');
	if (!exists) await git(['clone', '--quiet', REMOTE, WORKDIR], { auth: true, cwd: process.cwd() });
	await git(['fetch', '--quiet', 'origin', 'main'], { auth: true });
	await git(['checkout', '--quiet', '--force', '-B', 'main', 'origin/main']);
	await git(['clean', '-fdx', '--quiet', '-e', 'node_modules']);
	await run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: WORKDIR });
}

export async function hasChanges(): Promise<boolean> {
	return (await git(['status', '--porcelain'])) !== '';
}

// Commits everything on `branch` as Staffy Bot and pushes it. Returns the head SHA.
export async function commitAndPush(branch: string, message: string): Promise<string> {
	await git(['checkout', '--quiet', '-B', branch]);
	await git(['add', '--all']);
	await git(['-c', `user.name=${BOT_NAME}`, '-c', 'user.email=staffy-bot[bot]@users.noreply.github.com', 'commit', '--quiet', '-m', message]);
	await git(['push', '--quiet', '--force-with-lease', 'origin', `HEAD:refs/heads/${branch}`], { auth: true });
	return git(['rev-parse', 'HEAD']);
}
