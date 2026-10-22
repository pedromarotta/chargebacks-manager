# Architecture

Chargebacks Manager is an internal tool for an issuer-processor's disputes team. Clients (banks and fintechs) send in disputes, ops files them with the card network, and leads approve the money decisions. This page explains how it's built and why. SPEC.md is the full requirement, and AGENTS.md has the rules Devin followed.

## Shape
```
Browser (Next.js pages)
   │  every action is an HTTP call; the page holds no business logic
   ▼
Route handlers (src/app/api)
   │
   ▼
src/server
   ├── auth.ts      who is calling (signed dev cookie today, SSO later)
   ├── policy.ts    can(user, action): the only place roles are checked
   ├── disputes/    rules.ts (pure functions), service.ts (every write), queries.ts and view.ts (reads)
   ├── history.ts   the only writer of the audit trail
   ├── import.ts    validation of the daily disputes file
   └── network.ts   simulated card network, with an outbox and idempotent delivery
   │
   ▼
Prisma + SQLite (schema kept portable to Postgres)
```

## Decisions
| Decision | Why | What it costs us, or what changes in production |
|---|---|---|
| Every rule is checked on the server, through one `can()` function and one service per write | Hiding a button isn't a control. The UI can be bypassed with curl, and the rules still hold. | A little more code than putting the logic in the UI |
| Amount, proposer, status and deadline are re-read inside the transaction | A client can't send a fake amount or claim to be someone else | None worth noting |
| Maker-checker: the proposer can never approve, whatever their role; $500 or more needs a lead | These are money decisions. Two people, every time, with no admin bypass. | A second lead is needed when a lead proposes. The seed data has one. |
| The history is append-only, enforced by database triggers, and written in the same transaction as the change | An auditor needs proof, not a promise. Even a bug in the app can't edit the history. | With Postgres, the same rule moves to grants or triggers there |
| Network messages go out exactly once: a conditional status update, an idempotency key, and an outbox | Double clicks and two leads approving at the same moment must not send twice, and a network timeout must not lose or duplicate a message | The message is queued inside the transaction and delivered after commit; a retry never creates a second record on the network side (#12). |
| Full card numbers are refused everywhere: on import (Luhn check on every column), in notes and in merchant responses, and the history masks them as a backstop | Card numbers should never enter the system, not even by accident | Rare false positives on long numeric IDs; the user sees a plain reason and can fix it. A test pushes a card number through every input and scans every table, file and export (#8). |
| One identity seam (`getCurrentUser`) with an HMAC-signed dev cookie | Anyone trying the app needs a user switcher. Swapping in the company's SSO touches one file. | The dev login is disabled in production, and the cookie is marked Secure outside localhost (#13) |
| SQLite, with a schema portable to Postgres | Zero setup for a 2-hour build and for reviewers who want to run it | Production would run on the company's Postgres |
| Fight-or-accept uses rules and expected value, not AI | Money decisions must be explainable to compliance, and every number can be traced | Less clever with messy evidence. An LLM could later summarise documents or draft memos, through a direct model call and never deciding. |
| Devin builds the tool; it doesn't run inside it | Devin is a software engineer. Per-case answers would be slow and expensive through an agent. | — |

## Scope
**In:** importing the daily file (new disputes and merchant responses), the queue sorted by deadline risk, filing, the decision workflow with maker-checker, the history, the fight-or-accept helper, metrics, evidence files, pre-arbitration memos, bulk write-off, CSV export, the due-soon digest, the lifecycle timeline, funds tracking and the network outbox. 93 tests and CI on every PR.

**Out, on purpose:** a real login provider, a real card network or processor connection, deployment, email, AI features, and a Power Apps version of the same tool. Each of those depends on the customer's own stack, which I don't know yet.

## Path to production
1. Swap the dev cookie for the company's SSO (`auth.ts`).
2. Move to their Postgres; move the history triggers to grants.
3. Replace the simulated network with the real processor or network connection, behind the existing outbox.
4. Deploy through their existing CI/CD, with monitoring.
5. Give a named engineer ownership, with Devin making changes as reviewed PRs.

PR numbers in the table refer to this repo's merged pull requests; #1 holds the core, with a rule-to-test table in its description.
