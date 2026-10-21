# AGENTS.md

Chargebacks Manager is an internal tool owned by the engineering team. Devin writes the code and engineers review every PR. Read SPEC.md before planning. If SPEC.md and this file disagree, stop and ask.

## Stack
- Next.js (App Router) and TypeScript in strict mode, no `any`.
- Prisma with SQLite. Keep the schema portable to Postgres.
- Zod on every server input.
- Vitest, running against a real SQLite file.
- Tailwind with shadcn/ui, following DESIGN.md.
- Node 22, pinned in `.nvmrc`, `engines` and CI. If nvm is installed, run `nvm use 22` before npm commands.
- No Docker and no hosted services. `.env.example` holds dummy values only.
- Ask before adding any other dependency, and explain it in the PR.

Scripts (keep these names): `setup` (install, migrate, seed, generate the sample file), `dev`, `test`, `lint`, `typecheck`.

## Layout
- `src/server/auth.ts`: `getCurrentUser()`, the only identity seam. A dev cookie today, OIDC later. It re-reads the user from the database on every call.
- `src/server/policy.ts`: `can(user, action)`, deny by default. The only place roles are compared.
- `src/server/history.ts`: `record(tx, event)`, the only code that writes to the history table.
- `src/server/network.ts`: the simulated card network (CHARGEBACK, ACCEPT and PRE_ARB messages). Idempotency keys live in NetworkCall.
- `src/server/import.ts`: parsing and validation of the daily dispute file.
- `src/server/disputes/`: `rules.ts` (pure functions) and `service.ts` (every dispute write).
- `src/app/`: pages and route handlers. They call `src/server` and never import Prisma directly.

## Controls
These are not negotiable.
1. Every write calls `can()` on the server. Hiding a button is not a control.
2. Maker-checker: the person who proposed a decision can never approve or reject it, whatever their role.
3. Amount, proposer, status and due_at are read from the database inside the transaction, never taken from the client.
4. A business write and its history row commit in the same transaction. History is append-only: SQLite triggers abort UPDATE and DELETE.
5. Money is integer cents plus a currency. Timestamps are UTC.
6. Each network message goes out exactly once: a conditional status update plus an idempotency key.
7. Never store or show a full card number. Only `card_last4` exists.

## Tests
- One test per rule, named as a sentence, plus a positive control showing the allowed path works.
- Never weaken, skip or delete a failing test. Explain the problem in the PR instead.
- Each test file gets a fresh, migrated SQLite database.

## Pull requests
- One PR per task. The core PR branches from main. Backlog PRs may stack on the previous PR; name the base branch in the description.
- Never push to or merge main.
- Before opening a PR: run a clean `setup`, then lint, typecheck and test, then walk through the SPEC "Done when" steps in the browser as each user. After every successful action and every user switch, the page must show current data without a manual reload.
- The PR description includes screenshots, test output, a rule-to-test table, any SPEC ambiguities and how you resolved them, and what isn't done.
- Keep README.md current: how to run the app, the demo users, and what is real versus simulated.

## Building from a request
When someone asks for this tool in Slack:
1. Post a short plan in the thread: the data model, where each rule R1–R11 is enforced (file and function), the test list mapped to rules, and any SPEC ambiguity with your answer. Then continue without waiting.
2. Build the seams first (auth, policy, history, network, import), then the disputes service, then the pages.
3. Open one core PR to main once the SPEC "Done when" steps pass in the browser, including the curl refusal. Don't merge it.
4. Then work through the SPEC backlog in order, one PR per item, to the same standard, with CI green on each.
5. Post one line in the thread when each PR opens. If something blocks you (usage limits, missing access, an unclear SPEC), say so right away.
6. When you finish or stop, post a final summary in the thread: each PR with its open time, tests passing, what isn't done, and anything a reviewer should look at.
