# AGENTS.md

This is a [Flue](https://flueframework.com) project: agents are TypeScript functions.

## Layout

- `src/agents/` — agent modules. A module whose first line is the `'use agent'` directive exports agents: every exported capitalized function is one, and the function name is its durable identity.
- `src/db.ts` — the persistence adapter for durable conversations.

## Commands

- `ALLOW_LOCAL_SANDBOX=true npm run bugfix -- <ticket GID>` — start the bugfix agent on one Asana ticket (env from 1Password; copy `.env.schema.example` to `.env.schema.local` first). Each ticket has one Flue conversation (`bugfix-<GID>`, stored in `data/flue.db`) that later revisions continue.
- `ALLOW_LOCAL_SANDBOX=true npm run review:sweep -- --apply` — drive open bot PRs (CI fixes, review subtask, revisions, merge). Dry run without `--apply`; `--unstick <PR>` clears a stuck PR.
- `npm run asana:auth` — one-time OAuth consent for the Asana MCP app; prints the refresh token.
- `npm run check:types` — typecheck.
- `npx flue docs search <query>` — search the Flue docs from the terminal (then `flue docs read <path>`).
- `npx flue add` — list blueprints for adding channels, sandboxes, and databases.
