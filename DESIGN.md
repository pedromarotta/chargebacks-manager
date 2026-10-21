# DESIGN.md

A calm, dense operations tool in the style of Linear or the Stripe dashboard. Analysts work in it all day, so clarity beats decoration.

## Foundation
- shadcn/ui, adding only the components needed: Button, Badge, Table, Card, Tabs, Dialog, Select, Textarea, Tooltip, Separator, Toast.
- Inter through next/font, with tabular numbers for money and dates.
- An 8px grid, 44px table rows, and a maximum page width of 1280px.
- Top-left: "Chargebacks Manager · Internal tools". No Cognition or Microsoft branding.

Neutral greys with one accent (indigo-600). Status colours only carry meaning:

| Colour | Meaning |
|---|---|
| Green | Won |
| Indigo | Filed, waiting on the network |
| Amber | Decision pending approval, representment received, or deadline near |
| Red | Breached, lost, expired or refused |
| Grey | New or written off |

## Layout
**App shell.** A left sidebar with Disputes, Import, History and Metrics. A top bar with the current user's name and role, and a user switcher that changes user in one click.

**Queue (`/disputes`).**
- A strip of four numbers: open cases, at risk of timeout, amount at risk, provisional credit outstanding.
- Filter tabs: All, Needs my approval, Representment received, Due ≤72h, Closed.
- A table with case ID, client, merchant, amount (right-aligned), reason, a due-in badge and a status badge. A client filter sits next to the tabs.

**Case (`/disputes/[id]`).** Two columns.
- Left: the case header (amount, merchant, card ••••1234, reason, provisional credit, deadline countdown), the evidence checklist, the merchant response, and the decision panel, with the fight-or-accept helper.
- Right: the lifecycle timeline and the case history (avatar, action, before → after, note, time).

**Decision panel.**
- At NEW: a "File chargeback" button.
- At REPRESENTMENT_RECEIVED: three radio cards (Accept loss · write off; Accept loss · reverse provisional credit; Escalate to pre-arbitration, with its fee), a note field and "Propose decision". A "Needs lead approval" badge appears at $500 or more.
- When a decision is pending: Approve and Reject inside an "Awaiting approval" card.

## Behaviour
- Refusals appear inline and as a toast, in plain words, for example "You proposed this decision; a different lead must approve it." Never show rule numbers or error codes (R4, SELF_APPROVAL_BLOCKED) in the UI; they belong in the API response, the logs and the tests. Refusals also appear in the history, labelled in plain words. Nothing fails silently.
- After a successful action or a user switch, refresh the page data and clear forms and alerts. The user never needs to reload.
- After a refusal, keep the alert and whatever the user typed, so they can fix it and try again.
- Every list has an empty state and a loading state.
- No raw JSON or stack traces in the UI.

## Quality bar
- Screenshot every screen at 1440×900 for the PR.
- Keyboard-usable, visible focus rings, labelled inputs. Never rely on colour alone: every badge also has text or an icon.
