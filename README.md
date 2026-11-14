# automation-agents

A [Flue](https://flueframework.com) agent project.

## Setup

```sh
npm install
```

Then copy `.env.schema.example` to `.env.schema.local` and point it at the `staffy-automation-agents-local-env` 1Password item (see `.env.schema` for the variables).

## Talk to your agent

```sh
ALLOW_LOCAL_SANDBOX=true npm run bugfix -- <ticket GID>
```

Conversations are durable — pass `--id <id>` to continue one.

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `npx flue docs` from the terminal.
