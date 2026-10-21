# SPEC: Chargebacks Manager (issuer side)

We're an issuer-processor: we issue and process cards for banks and fintechs, our clients. When one of their cardholders disputes a charge, the client sends the dispute to us, and our ops team files the chargeback with the card network. If the merchant answers with its own evidence (a representment), ops decides whether to accept the loss or escalate to pre-arbitration. These are money decisions, so:
- the person who proposes a decision can never approve it;
- decisions of $500 or more need a lead;
- every action is recorded, including refused attempts.

BUSINESS_RULES.md has the domain background and DESIGN.md the UI. This file decides what gets built. All data is synthetic and the card network is simulated.

## Users
Seeded. A switcher in the header sets a dev-only httpOnly cookie, signed with SESSION_SECRET.

| id | Name | Role | Can |
|---|---|---|---|
| u_ana | Ana Ruiz | analyst | import, edit evidence, file chargebacks, propose decisions |
| u_ben | Ben Okafor | analyst | same as Ana |
| u_carla | Carla Diaz | lead | everything an analyst can, plus approve or reject decisions |
| u_eve | Eve Park | lead | same as Carla; a second lead, so a decision a lead proposed can still be approved |
| u_dan | Dan Lee | auditor | read and export only |

## Data
- **Dispute:** id, client (the bank or fintech whose cardholder disputes), card_last4, merchant, amount_cents, currency, reason_code (FRAUD, NOT_RECEIVED, NOT_AS_DESCRIBED or DUPLICATE), opened_at, due_at (the next network deadline), status (see R7), provisional_credit_cents, representment_received_at, merchant_response, decision_type (ACCEPT_LOSS_WRITE_OFF, ACCEPT_LOSS_REVERSE_CREDIT or ESCALATE_PRE_ARB), proposed_by, proposal_note, decided_by, decided_at, decision_note, network_ref.
- **EvidenceItem:** dispute_id, key, label, required, checked, checked_by, checked_at.
- **NetworkCall:** idempotency_key (unique), dispute_id, message (CHARGEBACK, ACCEPT or PRE_ARB), created_at.
- **History:** id, at, actor_id, actor_role, action, dispute_id, before (JSON), after (JSON), note.
- **ImportBatch and ImportRow:** counts per batch, and per row a result (IMPORTED, REJECTED or DUPLICATE) with a reason.
- **Fight-or-accept data:** p_win, expected_value_cents and recommendation, saved with the proposed decision (backlog item 0).

## Actions
Every morning ops imports one disputes file. It combines the new disputes our clients sent us and the merchant responses that came back from the network.

1. **File chargeback.** Analyst or lead, on a NEW dispute. Every evidence item required for the reason code must be checked (R2). Sends CHARGEBACK once (R8) and sets CHARGEBACK_FILED. No approval needed.
2. **Representment arrives.** Through the daily import (a row with merchant_response) or `npm run representment -- <id> "<text>"` (dev only). Sets REPRESENTMENT_RECEIVED, and due_at becomes the response deadline.
3. **Propose a decision.** Analyst or lead, at REPRESENTMENT_RECEIVED, with a note. The three choices:
   - *Accept loss · write off:* the loss is absorbed (by us or the client, per contract) and the cardholder keeps the credit.
   - *Accept loss · reverse provisional credit:* the client takes the credit back from the cardholder.
   - *Escalate to pre-arbitration:* show the fee from BUSINESS_RULES §4.

   Under $500 the decision executes immediately. At $500 or more the status becomes DECISION_PENDING (R3).
4. **Approve or reject.** A lead who did not propose the decision.
   - Approve sends ACCEPT or PRE_ARB once and sets WRITTEN_OFF, CLOSED_LOST (provisional credit set to 0) or PRE_ARB_FILED.
   - Reject returns the case to REPRESENTMENT_RECEIVED and clears the decision fields; the history keeps them.
5. **Ruling.** Dev only: `npm run ruling -- <id> WON|LOST` on a PRE_ARB_FILED case sets CLOSED_WON or CLOSED_LOST.

## Rules
Enforced on the server, using values read from the database inside the transaction. Every refusal also writes a history row (R9).

- **R1 Deadline.** Nothing can be filed, proposed, approved or rejected after due_at. The case becomes EXPIRED and the request gets 409 PAST_DEADLINE.
- **R2 Evidence.** Filing needs every required evidence item for the reason code checked; otherwise 409 EVIDENCE_REQUIRED.
- **R3 Threshold.** Decisions under 50000 cents execute when proposed; at 50000 or more they need approval. The threshold is per currency, and all seed data is USD.
- **R4 Maker-checker.** The person who proposed a decision can never approve or reject it, whatever their role. There is no bypass. Returns 409 SELF_APPROVAL_BLOCKED and writes a `decision_blocked` history row.
- **R5 Roles.** Leads approve and reject. Analysts and leads propose, file and import. Auditors read and export. Anything else returns 403 ROLE_NOT_ALLOWED.
- **R6 Notes.** Proposing and rejecting need a note of at least 10 characters, giving the reason; otherwise 400 NOTE_TOO_SHORT. Approving needs no note; an optional comment is saved if given.
- **R7 Status.** NEW → CHARGEBACK_FILED → REPRESENTMENT_RECEIVED → (DECISION_PENDING) → WRITTEN_OFF, CLOSED_LOST or PRE_ARB_FILED → CLOSED_WON or CLOSED_LOST. Any open case can become EXPIRED. Decisions use a conditional update `WHERE status = 'DECISION_PENDING'`; a second decision gets 409 ALREADY_DECIDED.
- **R8 Exactly once.** `network.submit({ idempotencyKey: dispute.id + ':' + message })`. A repeated key returns the first result, so double clicks and concurrent approvals produce one NetworkCall.
- **R9 History.** Every change and every refused attempt writes one history row in the same transaction. The history table is append-only: SQLite triggers abort UPDATE and DELETE.
- **R10 Import.** Analysts and leads only.
  - A row is rejected, with its reason recorded, if it has a missing or invalid amount, currency, due_at or reason_code; a card field that isn't exactly 4 digits; or any 13–19 digit number that passes the Luhn check, in any column.
  - A case_id that already exists is recorded as DUPLICATE.
  - Valid rows become NEW cases, or REPRESENTMENT_RECEIVED when merchant_response is present. Each gets the evidence checklist for its reason code and a provisional credit equal to the amount.
  - Each batch writes one history row with its counts.
- **R11 Session.** The dev session cookie is HMAC-signed with SESSION_SECRET. A missing, unsigned or tampered cookie gets 401. Dev login is disabled when NODE_ENV=production.

## Screens
- **`/import`:** upload a CSV and preview every row as valid or rejected, with the reason. Confirm, then show "Imported N · Rejected M · Duplicates K" with the rejected rows listed.
- **`/disputes`:** the queue, sorted by deadline risk (BUSINESS_RULES §3), with due-in and status badges, filter tabs, and a counter of network calls.
- **`/disputes/[id]`:** the case header, evidence, merchant response, decision panel, lifecycle timeline and history. Approve and Reject are shown to every lead, including the proposer, because the server is what refuses.
- **`/history`:** every history row, filterable, with refusals highlighted.
- **API:** `POST /api/disputes/[id]/file | propose | approve | reject` and `POST /api/import`, using the same service code as the UI.

**Sample file.** `samples/disputes-today.csv`, the daily disputes file, regenerated by `npm run sample` with due dates relative to today. It has 14 rows from three clients: 10 new disputes, 2 where the merchant's response has come back from the network, 1 with a full card number in the merchant field, and 1 with no amount. Columns: case_id, client, card_last4, merchant, amount, currency, reason_code, opened_at, due_at, merchant_response.

## Seed
Fixed ids, safe to re-run. These are yesterday's cases; today's arrive through the import. Seed and sample data use well-known merchants (Amazon, MercadoLibre, Netflix, Spotify, Uber, Rappi, Airbnb, Apple) with made-up amounts and cardholders, and three made-up clients: Norte Bank, Pampa Wallet and Andes Pay.
- **CB-1042:** Norte Bank, Amazon, $1,240 FRAUD, provisional credit $1,240, REPRESENTMENT_RECEIVED. Merchant response: "Transaction authenticated with 3DS 2.0; device and IP match the cardholder's history." This is the main demo case.
- **CB-1088:** Pampa Wallet, MercadoLibre, $2,310 NOT_AS_DESCRIBED, DECISION_PENDING (escalate to pre-arbitration), proposed by Carla.
- **CB-1003 and CB-1004:** REPRESENTMENT_RECEIVED at $499.99 and $500.00.
- One NEW case ready to file, one EXPIRED and one WRITTEN_OFF, each with its history.

## Tests
Vitest. Each test name is a sentence that includes the rule id.
- An analyst cannot approve a decision (R5).
- The proposer cannot approve or reject their own decision, even as a lead (R4).
- A different lead can approve: Eve approves Carla's CB-1088 (positive control).
- $499.99 executes when proposed; $500.00 waits for approval (R3).
- Filing without the required evidence is refused (R2).
- Nothing can be filed, proposed, approved or rejected after the deadline (R1).
- Approving twice, or twice at the same time, makes exactly one NetworkCall (R7, R8).
- Reversing the credit sets it to 0; writing off keeps it.
- The import rejects a full card number and a missing amount, imports the rest, and sends merchant_response rows to REPRESENTMENT_RECEIVED (R10).
- A tampered session cookie gets 401 (R11).
- Every write leaves exactly one history row, and UPDATE or DELETE on history throws (R9).

## Done when
Walk through these in the browser.
1. As Ana, import the sample file: 12 imported, 2 rejected (full card number, missing amount). The queue fills, sorted by deadline risk.
2. As Ana, open CB-1042, read the merchant response, and propose "Accept loss · reverse provisional credit" with a note. It becomes DECISION_PENDING.
3. As Ana, click Approve. It's refused (R5) with a clear message. The same request with curl gets 403.
4. As Carla, approve CB-1042. It becomes CLOSED_LOST, the provisional credit drops to 0, and network calls go up by one. Approving again is refused, still with one call.
5. As Carla, approve CB-1088, which she proposed. It's refused (R4). As Eve, approve it: it becomes PRE_ARB_FILED with one call.
6. The history shows every step, including both refused attempts.
7. Throughout, every successful action and every user switch shows the new state at once, with no leftover alerts or notes and no reload. A refusal keeps its alert and the typed note, so the user can fix it and retry.

## Backlog
Start only after the core PR is open. One PR per item, in this order.

0. **Fight-or-accept helper** (BUSINESS_RULES §4). On a case at REPRESENTMENT_RECEIVED, the analyst enters P(win) and sees the expected recovery, the expected cost (with the network's fees) and a recommendation: fight or accept. The analyst still chooses. P(win), the expected value and the recommendation are saved with the proposed decision and shown to the approver. Rules only, no AI: every number can be explained.
1. **Metrics page:** open disputes by days left, win and loss rate on closed cases, amount at risk, provisional credit outstanding, and how often the decision matched the recommendation.
2. **Evidence files:** attach files to evidence items (local storage), with a history row for each upload.
3. **Pre-arbitration memo:** draft a memo from a template per reason code when escalating, editable before approval.
4. **Bulk write-off:** select several cases under $500 at REPRESENTMENT_RECEIVED and write them off in one action. Each case still gets its own history row.
5. **CSV export** of the queue and the history, for auditors.
6. **Card number audit:** a test proving no full card number can be stored, returned or exported.
7. **Due-soon digest:** an in-app list of cases due within 2 days. No email.
8. **Lifecycle timeline** of the 8 steps (BUSINESS_RULES §1) on the case page, including the rejected-filing path.
9. **Funds tracking** (§5): status after a won case, how long funds have been parked, and alerts by jurisdiction. Moving funds to the cardholder, or reversing them, needs maker-checker (R4).
10. **Network outbox:** move the simulated network out of the database transaction. Write an outbox row inside the transaction, submit after commit with the idempotency key, and test that a timeout followed by a retry produces exactly one record on the network side.

**Out of scope:** a real identity provider, a real card network, real email, and deployment.
