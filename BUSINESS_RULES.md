# BUSINESS_RULES.md: card disputes, issuer side

We're an issuer-processor: we issue and process cards for banks and fintechs, our clients. Their cardholders dispute charges with them, the clients send the disputes to us, and our ops team works each case through the card network before its deadlines. Merchant responses and rulings come back to us from the network, and we keep the client informed. This file describes the business rules only; SPEC.md decides what gets built. The rules are adapted from a disputes tool I built for a Series C fintech in Argentina, a card issuer-processor. All numbers are illustrative and must be checked with compliance before production.

## 1. Lifecycle

| # | Step | Owner | What happens |
|---|---|---|---|
| 1 | Intake | client, then analyst | The cardholder disputes with the client (the bank or fintech), and the client sends the dispute to us. |
| 2 | Validation | analyst | Check eligibility, time frames and the reason code. The client usually gives the cardholder a provisional credit while the dispute runs. |
| 3 | Filing | analyst | The chargeback is filed with the network. |
| 4 | Evidence | analyst | The cardholder's evidence is attached, within a short window (around 8 days). |
| 5 | Representment | merchant | The merchant may answer with evidence, within about 45 days. If it doesn't answer, the issuer wins, which is common. |
| 6 | Analysis | analyst proposes, lead approves | Review the merchant's evidence and decide: fight (pre-arbitration, which has a fee) or accept the loss (write it off, or reverse the cardholder's provisional credit). These are money decisions: above a threshold a lead approves, and nobody approves their own. |
| 7 | Pre-arbitration | analyst | Submit the pre-arbitration case. The acquirer can accept it or escalate. |
| 8 | Arbitration | network | The network rules, usually within about 30 days. |

Completed steps form an unbroken sequence: the first incomplete step is the current one, and later steps can't be completed before it.

If the network rejects the filing, step 3 is marked failed, steps 4 to 8 don't apply, and ops reviews the case: reverse the provisional credit or write it off.

## 2. Network statuses
Networks and processors report PENDING, UNDER_EVALUATION, DISPUTE_OPEN, DISPUTE_WON, DISPUTE_LOST, DISPUTE_REJECTED, NOT_PROCESSED and TRANSACTION_NOT_PRESENTED.

The tool uses its own, finer workflow (SPEC.md R7). Roughly: NEW covers PENDING and UNDER_EVALUATION; CHARGEBACK_FILED to PRE_ARB_FILED cover DISPUTE_OPEN; CLOSED_WON, CLOSED_LOST and WRITTEN_OFF cover the won and lost outcomes.

## 3. Deadline risk
Computed from due_at for each open dispute:

| Tier | Time left |
|---|---|
| ok | more than 72 hours |
| near | 72 hours or less |
| imminent | 24 hours or less |
| breached | past due |

The queue sorts breached first, then imminent, near and ok. Open disputes that are near, imminent or breached count as "at risk of timeout", which is a key ops metric.

## 4. Fight or accept
Used at step 6.
- Expected recovery = P(win) × disputed amount.
- Expected cost = pre-arbitration fee + P(lose) × arbitration fee + internal handling cost (about $35).
- Fight when expected recovery minus expected cost is above a threshold (default 0); otherwise accept.

Illustrative fees, to be checked against the networks' current published fees:

| Network | Pre-arbitration | Arbitration (paid by the loser) |
|---|---|---|
| A | $15 | $650 |
| B | $500 | $600 |

P(win) comes from the analyst or a scoring model. The tool shows a recommendation; the analyst decides.

## 5. Funds tracking after a won dispute
This applies when the cardholder did not get a provisional credit, which is common in some Latin American markets: the money reaches the cardholder only after the win. When a provisional credit was given, a win simply makes it final.

Funds move through FUNDS_NOT_YET_RECEIVED, FUNDS_RECEIVED_FROM_ACQUIRER, FUNDS_CREDITED_TO_PROGRAM and FUNDS_CREDITED_TO_CARDHOLDER, or FUNDS_REVERSED.

Funds are "parked" once received or credited to the program but not yet credited to the cardholder. Track how long they have been parked: under 24 hours, 1 to 3 days, 3 to 7 days, over 7 days, and over the regulatory limit.

Each jurisdiction sets a maximum time to credit the cardholder. Raise an alert when parked time reaches that maximum minus a buffer. Illustrative limits, to be checked with legal:

| Jurisdiction | Maximum (hours) | Alert buffer (hours) |
|---|---|---|
| US | 240 | 24 |
| EU | 240 | 24 |
| BR | 168 | 24 |
| MX | 480 | 48 |
| CO, PE, CL | 360 | 36 |
| AR | 240 | 24 |

## 6. Evidence types
Statement, receipt, fraud affidavit, delivery proof, chat log, other. Each upload writes a history event.

## 7. Dispute types and reason codes
Disputes are either fraud or a merchant dispute. Network A uses 4-digit reason codes (for example 4853 or 4837); network B uses dotted codes (for example 10.4 or 13.1), so the network can be inferred from the format. SPEC.md simplifies these into four categories: FRAUD, NOT_RECEIVED, NOT_AS_DESCRIBED and DUPLICATE.

## 8. Merchant type
Physical goods, digital service, service provider (travel, ride, delivery) or financial service. Pre-arbitration memos adapt their wording to it; for example, they don't mention shipping for merchants that don't ship goods.

## 9. Metrics an ops lead wants
- Open disputes at risk of timeout.
- Win rate on resolved disputes.
- Total disputed amount.
- Regulatory alerts on parked funds.
- How often the final decision matched the recommendation.

## 10. Data hygiene
- Never store or show a full card number. Use the last four digits or a token.
- Money is integer cents plus a currency.
- History is append-only.
