# Chargebacks Manager

> **Built by Devin from one Slack message.** I wrote the four input files (AGENTS.md, SPEC.md, BUSINESS_RULES.md, DESIGN.md); Devin wrote the code in 12 PRs, plus a 13th from one follow-up message for the review fixes. I reviewed and merged all 13.
>
> [Loom](https://www.loom.com/share/cecd79c4ceea45ae9c5394263639de05) · How it was built: [BUILD_LOG.md](BUILD_LOG.md) · Architecture: [ARCHITECTURE.md](ARCHITECTURE.md) · Key decisions: [docs/KEY_DECISIONS.md](docs/KEY_DECISIONS.md)

Internal, issuer-side tool for the disputes team: import the clients' daily disputes file, file chargebacks with the card network, review merchant responses, propose and approve money decisions (maker-checker), and keep an append-only history of every change and every refused attempt.

`SPEC.md` decides what gets built, `BUSINESS_RULES.md` explains the domain, `DESIGN.md` the UI, and `AGENTS.md` the engineering rules.

## Run it

Requires Node 22 (`nvm use` reads `.nvmrc`). No Docker or hosted services.

```bash
npm run setup   # install, create .env from .env.example, migrate SQLite, seed demo data, write samples/disputes-today.csv
npm run dev     # http://localhost:3000
```

| Script | What it does |
|---|---|
| `npm test` | Vitest against real SQLite files (a fresh migrated copy per test file) |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm run reset` | Wipe the database, re-seed, regenerate the sample file |
| `npm run sample` | Regenerate `samples/disputes-today.csv` with due dates relative to today |
| `npm run representment -- CB-1234 "merchant response text"` | Simulate the network delivering a merchant response (CHARGEBACK_FILED → REPRESENTMENT_RECEIVED) |
| `npm run ruling -- CB-1234 WON\|LOST` | Simulate the network's ruling on a pre-arbitration case |

## Demo users

Pick a user with the "Act as" switcher in the top bar (one click; no reload needed).

| User | Role | Can |
|---|---|---|
| Ana Ruiz (`u_ana`), Ben Okafor (`u_ben`) | Analyst | Import, check evidence, file chargebacks, propose decisions |
| Carla Diaz (`u_carla`), Eve Park (`u_eve`) | Lead | Everything an analyst can, plus approve or reject decisions (never their own) |
| Dan Lee (`u_dan`) | Auditor | Read only |

Seeded cases include CB-1042 (Norte Bank · Amazon · $1,240 · fraud · merchant responded), CB-1088 (Pampa Wallet · MercadoLibre · $2,310 · Carla proposed pre-arbitration, waiting for another lead), and CB-1003 / CB-1004 ($499.99 / $500.00, either side of the approval threshold).

## Fight-or-accept helper

On a case at "Representment received", the analyst enters P(win) and the decision panel shows (BUSINESS_RULES §4, `src/lib/fight-or-accept.ts`):

- expected recovery = P(win) × amount
- expected cost = pre-arbitration fee + P(lose) × arbitration fee + $35 handling
- recommendation: fight when recovery − cost > $0, otherwise accept

The analyst still chooses. The server recomputes P(win), the expected value and the recommendation from the amount in the database and saves them with the proposal. The approver sees them, plus whether the decision follows the recommendation. P(win) is optional in the API.

## Metrics

`/metrics` (every role, including the auditor) is computed live by `computeMetrics()` in `src/server/disputes/metrics.ts`:

- open disputes by days left (past due, ≤1, 1–3, 3–7, 7–14, >14 days), plus the amount at risk of timeout (≤72h or past due)
- provisional credit outstanding on open cases
- win and loss rate on closed cases (written off and expired count as losses)
- how often the decided action matched the fight-or-accept recommendation (only decisions saved with a P(win))

## Evidence files

Analysts and leads can attach files to evidence items while the case is still open for evidence (New, Chargeback filed, Representment received). Everyone, auditors included, can download them. The code is in `src/server/files.ts` and `attachEvidenceFile()`.

- Storage is local, in `UPLOAD_DIR` (default `./uploads`, gitignored, cleared by `npm run reset`). Files are saved under a random UUID, never under the uploaded name.
- Accepted: PDF, PNG and JPEG, detected from the file's bytes, up to 5 MB.
- Files with a full card number in the name or readable text are refused. This is best effort: compressed PDF text and images can't be scanned, so redact before uploading.
- Each upload writes one `evidence_file_attached` history row with the file name, size and SHA-256. Refusals write a row too.
- `POST /api/disputes/:id/files` takes multipart `key` + `file` and requires the header `x-cbm-upload: 1`, which blocks cross-site form posts. `GET /api/disputes/:id/files/:fileId` always downloads the file as an attachment.

## Pre-arbitration memo

When an analyst chooses *Escalate to pre-arbitration*, the decision panel drafts a memo from a template for the case's reason code (`src/lib/pre-arb-memo.ts`). The analyst picks the merchant type (physical goods, digital service, service provider or financial service) and the wording adapts to it. For example, a digital-service memo asks for access logs, not proof of delivery. The memo is editable before proposing and is saved with the proposal.

- While the escalation waits for approval, only the proposer can edit the memo (`POST /api/disputes/:id/memo {"memo": "..."}`). Each edit writes a `memo_edited` history row with the old and new text. The approver reads the memo but can't change it, so the person who approves never wrote the text (maker-checker).
- Memos need at least 10 characters, can be at most 5,000, and are refused if they contain a full card number. If an API call escalates without a memo, the template draft for physical goods is saved.
- Rejecting the decision clears the memo. Approving keeps it on the case.

## Bulk write-off

On the queue, analysts and leads get a checkbox on each case they can write off in bulk: at *Representment received*, under $500.00 and not past due. Select some or all of them, add one note, and click *Write off N cases*. Auditors don't see the checkboxes.

- `POST /api/disputes/bulk-write-off {"ids": [...], "note": "..."}` takes 1–50 different cases. `bulkWriteOff()` runs each case through the normal propose path in its own transaction, so every rule still applies per case: role, deadline, status, the $500 limit, exactly-once network submission and history.
- Each case gets its own `decision_executed` history row. All rows from one run share a `bulkId`. A case that can't be written off (over the limit, wrong step, expired) is refused with its own history row, and the others still go through. The response lists the result for each case.
- A bad role, a short note or an invalid selection refuses the whole request once, before any case is touched.

## CSV export

Auditors get an *Export CSV* button on the queue and on the history page. Both export what's on screen with the current tab or filters applied. Analysts and leads don't have the `export` permission (SPEC R5), so the routes return 403 for them.

- `GET /api/export/queue?tab=&client=` exports one row per case: case, client, `card_last4`, merchant, amount and provisional credit as decimals (`1240.00`), currency, reason, status, UTC timestamps, due risk and decision fields.
- `GET /api/export/history?kind=&actor=&case=` exports every matching history row, not only the 1,000 the page shows. Each row has the plain-language summary and changes plus the raw before/after JSON.
- Files download as `text/csv` attachments with `no-store`. Cells are RFC 4180 quoted. A cell that starts with `= + - @` gets a leading `'` so spreadsheets won't run it as a formula. As a last line of defense, anything that looks like a full card number is replaced with `[card number removed]`.
- Each export writes a `data_exported` history row recording who exported, what, how many rows and which filters.

## Due-soon digest

*Due soon* in the sidebar, with a count badge, lists every open case due within 48 hours, including open cases already past due that haven't been expired yet. Cases are grouped into past due, the next 24 hours and 24–48 hours, then sorted by deadline risk. Each row shows the next step and a *Needs you* tag when the current user can take it. For example, a lead sees "Approve or reject" on a pending decision unless they proposed it. `getDueSoonDigest()` is read-only: opening the page never writes or expires anything (R1 expiry still only happens when someone acts on a case). It's in-app only, so no email is sent.

## Lifecycle timeline and rejected filings

The case page shows the 8 steps from BUSINESS_RULES §1: intake, validation, filing, evidence, representment, analysis, pre-arbitration and arbitration. `buildTimeline()` (`src/lib/timeline.ts`) works out each step's state (done, current, failed, doesn't apply, not started) and date from the case and its history. Completed steps form an unbroken sequence, and the first incomplete one is current. An accepted loss marks steps 7–8 as not applying. Expiry marks the current step failed.

**Rejected filing.** The network can reject a filed chargeback. Simulate it with `npm run reject-filing -- <case_id> "<reason>"`, which goes through `rejectFiling()`, a `network:event`. The case moves to `FILING_REJECTED`, step 3 shows as failed with the reason, steps 4–8 don't apply, and an *Ops review* step becomes current. Ops review can only accept the loss, either by writing it off or by reversing the credit, and the normal rules apply: the $500 threshold, maker-checker, notes, and deadline (30 days). Pre-arbitration is refused. No network message is sent on that decision, because no chargeback exists at the network. Rejecting the proposal returns the case to `FILING_REJECTED`.

## Funds tracking

This covers BUSINESS_RULES §5 for won cases where the cardholder had no provisional credit. A `WON` ruling on a case with `provisional_credit_cents = 0` sets `funds_status = FUNDS_NOT_YET_RECEIVED`. When a provisional credit was given, the win just makes it final, so there's nothing to track.

`FUNDS_NOT_YET_RECEIVED → FUNDS_RECEIVED_FROM_ACQUIRER → FUNDS_CREDITED_TO_PROGRAM → FUNDS_CREDITED_TO_CARDHOLDER`, or `FUNDS_REVERSED` from received or program.

- Receipt is a network event: `npm run funds-received -- <case_id>`.
- *Mark credited to program* is an internal ledger step for analysts and leads.
- Crediting the cardholder or reversing always needs maker-checker, whatever the amount (R4). An analyst or lead proposes it with a note (R6), and a different lead approves or rejects it. A self-decision gets 409 `SELF_APPROVAL_BLOCKED` and a `decision_blocked` row. The API actions are `funds-program | funds-propose | funds-approve | funds-reject` on `/api/disputes/[id]/...`.
- Funds are parked from receipt until they're credited to the cardholder or reversed. The `/funds` page groups parked funds by age (<24h, 1–3d, 3–7d, >7d, over the limit) and flags each case against its jurisdiction's limit minus the buffer (`JURISDICTION_LIMITS` in `src/lib/funds.ts`, illustrative). The sidebar badge counts alerts.
- Each case's `jurisdiction` defaults to `US`. Seeds CB-1008 (BR, over the limit) and CB-1009 (MX, within the limit) show both.

## Network outbox

Calls to the simulated network no longer happen inside the database transaction.

- In the transaction, `enqueue()` in `src/server/network.ts` writes an `OutboxMessage` row (`PENDING`), keyed by `idempotencyKey = <case_id>:<message>`, together with the business change and its history row. If the write is refused or rolled back, no message is queued.
- After the commit, `deliverOutbox()` sends each pending row with its key. The simulated network keeps its own record (`NetworkCall`), dedupes by key and returns the original `network_ref` on a repeat.
- A timeout leaves the row `PENDING` with `attempts` and `last_error` set. `npm run outbox` retries all pending rows, and so does the next write. Retrying is always safe: a timeout followed by a retry, or several retries at once, still leaves exactly one record on the network side (`tests/outbox.test.ts`).
- `dispute.network_ref` is set when the `CHARGEBACK` message is acknowledged. History records `networkMessage` and not the ref, because the ref doesn't exist yet at commit time.
- The queue's network-call counter shows how many messages are still pending.

## Card number audit

`tests/pan-audit.test.ts` is the proof that a full card number can't be stored, returned or exported. Using four card-number formats (plain, spaced, dashed, Amex), it sends a PAN through every write path: import fields, the import filename, decision notes, approve and reject notes, memos, bulk notes and ids, representment text, evidence keys, file names and file bytes, and case ids in the URL. Then it:

- reads every string column of every table, plus every uploaded file, and expects no Luhn-valid 13–19 digit run;
- serializes every response from those writes, plus every case page, the queue, the full history and both CSV exports, and expects the same.

How it's enforced:

1. Request free text holding a card number is refused with "This looks like a full card number. Remove it and use only the last 4 digits." The refusal row doesn't copy the text.
2. `record()` runs a backstop, `redactCardNumbers()`, over every history note and before/after value, so a write path that forgets step 1 still can't put a PAN in History.
3. CSV exports apply the same redaction to every cell.

Before this change, the audit found one real leak: a card number in an import *filename* was copied into the refusal's history row.

## API

The UI calls the same routes, so curl gets the same answers. Bodies are JSON; errors are `{ "error": { "code", "message" } }`.

```
POST /api/disputes/:id/file
POST /api/disputes/:id/propose   { "decisionType": "ACCEPT_LOSS_WRITE_OFF" | "ACCEPT_LOSS_REVERSE_CREDIT" | "ESCALATE_PRE_ARB", "note": "...", "pWinPct"?: 0-100 }
POST /api/disputes/:id/approve   { "comment"?: "..." }
POST /api/disputes/:id/reject    { "note": "..." }
POST /api/disputes/:id/evidence  { "key": "statement", "checked": true }
POST /api/import                 { "csv": "...", "filename"?: "...", "dryRun"?: true }
POST /api/session                { "userId": "u_ana" }   (dev login; 404 in production)
```

Example (Ana is an analyst, so approving is refused with 403):

```bash
curl -s -c ana.jar -H 'content-type: application/json' -d '{"userId":"u_ana"}' localhost:3000/api/session
curl -s -b ana.jar -H 'content-type: application/json' -d '{}' localhost:3000/api/disputes/CB-1088/approve -w ' %{http_code}\n'
```

## Where the rules live

| Rule | Enforced in |
|---|---|
| R1 deadline | `src/server/disputes/service.ts` `loadCase()` (expires the case and refuses), `rules.ts` `isPastDeadline()` |
| R2 evidence | `service.ts` `fileChargeback()`, `rules.ts` `missingRequiredEvidence()` / `EVIDENCE_TEMPLATES` |
| R3 threshold | `service.ts` `proposeDecision()`, `rules.ts` `needsApproval()` (USD 50000 cents; other currencies always need approval) |
| R4 maker-checker | `service.ts` `approveDecision()` / `rejectDecision()`, `rules.ts` `isSelfDecision()` |
| R5 roles | `src/server/policy.ts` `can()` (deny by default), called first by every write |
| R6 notes | `rules.ts` `isValidNote()` (10+ characters after trimming) |
| R7 status | conditional `updateMany({ where: { id, status } })` in every transition |
| R8 exactly once | `src/server/network.ts` `submit()` with a unique idempotency key `<caseId>:<message>` |
| R9 history | `src/server/history.ts` `record()` inside the same transaction; SQLite triggers in the init migration abort UPDATE/DELETE |
| R10 import | `src/server/import.ts` (CSV parsing, field checks, Luhn scan of every cell) |
| R11 session | `src/server/auth.ts` (HMAC-SHA256-signed cookie, user re-read from the database each request) |

## Simulated vs real

| Part | Here | In production |
|---|---|---|
| Sign-in | Dev user switcher setting a signed cookie; disabled when `NODE_ENV=production` | A real identity provider behind `getCurrentUser()` |
| Card network | "Network A (simulated)" in `src/server/network.ts`: records each message once per idempotency key and returns a fake reference. Fees: $15 pre-arbitration, $650 arbitration (illustrative) | The network's API |
| Merchant responses and rulings | `npm run representment` / `npm run ruling` | Network webhooks or files |
| Database | SQLite file `prisma/dev.db` | Postgres (schema avoids SQLite-only types) |

All fees, windows and thresholds are illustrative and must be confirmed with compliance before production.

## Dependencies beyond the AGENTS.md stack

- `tsx` (dev): runs the TypeScript scripts (seed, sample, representment, ruling).
- `sonner`: the toast component shadcn/ui ships.
- `@base-ui/react`, `class-variance-authority`, `cn`, `lucide-react`, `shadcn`, `tw-animate-css`: installed by `shadcn init` / `shadcn add` for the generated components.
