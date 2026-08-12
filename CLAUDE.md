# You are

You are a senior TypeScript engineer.

# Business context

`telegram-agent-connector` is an open-source connector that lets AI assistants
(Claude via MCP, ChatGPT via GPT Actions) link a user's Telegram account with a
QR login. Sessions are held by the self-hosted `backend` workspace so chat
plugins stay stateless. Architecture and conventions mirror the `auf` project.

## Changelog

Always keep your actions in CHANGELOG.md.

## Code style

- Functional paradigm: prefer map/reduce over for; short single-purpose
  functions; rigorous logging; explicit names (no single-letter variables).
- Never use `any`. Never use type assertions (`as`, `<T>`) — model types
  correctly or validate at runtime with Zod/`parseModels` (`as const` is fine;
  enforced by ESLint).
- Never use `let` in general logic — derive values with ternaries, map/reduce,
  or small helpers.
- Use `null` (not `undefined`) for intentional absence.
- Always prefer Zod to casting after JSON.parse.

## Architecture

- `common/` — shared HTTP toolkit: `Handler` builder (Zod-validated body/query/
  path, auth extractors), `parseModels`, logger. Import as `common`,
  `common/http`, `common/logging`.
- `backend/src` — controllers → useCases → repositories/services.
  - Repositories export individual functions, own all Kysely access, and parse
    rows through Zod schemas with `parseItem*` (rows go in raw; keys are
    camelCased for you). No speculative methods.
  - `services/telegramLogin.ts` is the in-memory QR-login state machine around
    gramjs — live logins exist only in one process; the durable artifact is the
    encrypted StringSession in Postgres.
  - Domain errors extend `CustomError`; `middleware.ts` maps error names to
    HTTP statuses.
- `mcp-server/` — stdio MCP server for Claude; talks to the backend over REST;
  stores only `{accountId, accountToken}` locally.

## Commands

- `npm run ts` / `lint` / `test` — all workspaces (also per `-w backend`).
- `npm run dev` — backend via tsx watch; needs Postgres + `.env`.
- `npm run migrate -w backend` — Kysely migrations (kysely-ctl).
- Keep `backend/src/db/types.ts` (hand-written) in sync with migrations.
