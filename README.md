# Chargebacks Manager

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
