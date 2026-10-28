import { defineMcpConnection } from '@flue/runtime';

export const ASANA_TOKEN_URL = 'https://app.asana.com/-/oauth_token';

// Asana access tokens live for an hour; refresh a minute early.
const EXPIRY_MARGIN_MS = 60_000;
let cached: { token: string; expiresAt: number } | undefined;

async function accessToken(): Promise<string> {
	if (cached && Date.now() < cached.expiresAt) return cached.token;
	const { ASANA_MCP_CLIENT_ID, ASANA_MCP_CLIENT_SECRET, ASANA_MCP_REFRESH_TOKEN } = process.env;
	if (!ASANA_MCP_CLIENT_ID || !ASANA_MCP_CLIENT_SECRET || !ASANA_MCP_REFRESH_TOKEN) {
		throw new Error('Asana MCP credentials are not set — see .env.schema');
	}
	const res = await fetch(ASANA_TOKEN_URL, {
		method: 'POST',
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			client_id: ASANA_MCP_CLIENT_ID,
			client_secret: ASANA_MCP_CLIENT_SECRET,
			refresh_token: ASANA_MCP_REFRESH_TOKEN,
		}),
	});
	if (!res.ok) throw new Error(`Asana token refresh failed: ${res.status}`);
	const body = (await res.json()) as { access_token: string; expires_in: number };
	cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 - EXPIRY_MARGIN_MS };
	return cached.token;
}

// Asana's V2 MCP server is OAuth-only, so auth resolves a fresh token per request.
export const asana = defineMcpConnection({
	name: 'asana',
	url: 'https://mcp.asana.com/v2/mcp',
	auth: accessToken,
});
