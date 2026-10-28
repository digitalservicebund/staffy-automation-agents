# AGENTS.md

This is a [Flue](https://flueframework.com) project: agents are TypeScript functions.

## Layout

- `src/agents/` — agent modules. A module whose first line is the `'use agent'` directive exports agents: every exported capitalized function is one, and the function name is its durable identity.
- `src/db.ts` — the persistence adapter for durable conversations.

## Commands

- `npx varlock run -- npx flue run src/agents/bugfix.ts --message "Hi"` — run an agent locally with env from 1Password (copy `.env.schema.example` to `.env.schema.local` first).
- `npm run asana:auth` — one-time OAuth consent for the Asana MCP app; prints the refresh token.
- `npm run check:types` — typecheck.
- `npx flue docs search <query>` — search the Flue docs from the terminal (then `flue docs read <path>`).
- `npx flue add` — list blueprints for adding channels, sandboxes, and databases.
