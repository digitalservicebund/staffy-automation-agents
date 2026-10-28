// One-time OAuth consent for the Asana MCP app. Prints the refresh token to
// store as ASANA_MCP_REFRESH_TOKEN in 1Password. The app's redirect URL in
// Asana must be exactly REDIRECT_URI below.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { ASANA_TOKEN_URL } from '../src/connections/asana.ts';

const PORT = 8787;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

const { ASANA_MCP_CLIENT_ID: clientId, ASANA_MCP_CLIENT_SECRET: clientSecret } = process.env;
if (!clientId || !clientSecret) throw new Error('ASANA_MCP_CLIENT_ID / ASANA_MCP_CLIENT_SECRET are not set');

const state = randomBytes(16).toString('hex');
const authorizeUrl = new URL('https://app.asana.com/-/oauth_authorize');
authorizeUrl.search = new URLSearchParams({
	client_id: clientId,
	redirect_uri: REDIRECT_URI,
	response_type: 'code',
	state,
}).toString();

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? '/', REDIRECT_URI);
	if (url.pathname !== '/callback') return void res.writeHead(404).end();
	const code = url.searchParams.get('code');
	if (url.searchParams.get('state') !== state || !code) {
		res.writeHead(400).end('Invalid state or missing code.');
		return;
	}
	const tokenRes = await fetch(ASANA_TOKEN_URL, {
		method: 'POST',
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: clientId,
			client_secret: clientSecret,
			redirect_uri: REDIRECT_URI,
			code,
		}),
	});
	if (!tokenRes.ok) {
		res.writeHead(502).end('Token exchange failed — see terminal.');
		console.error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
	} else {
		const { refresh_token } = (await tokenRes.json()) as { refresh_token: string };
		res.end('Done — return to the terminal.');
		console.log(`\nASANA_MCP_REFRESH_TOKEN=${refresh_token}\n\nStore it in 1Password, then discard this output.`);
	}
	server.close();
});

server.listen(PORT, () => console.log(`Open this URL and approve access:\n\n${authorizeUrl}\n`));
