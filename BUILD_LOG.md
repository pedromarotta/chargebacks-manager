# How this was built

Everything in this repo except AGENTS.md, SPEC.md, BUSINESS_RULES.md, DESIGN.md, BUILD_LOG.md, ARCHITECTURE.md, docs/KEY_DECISIONS.md and the first lines of README.md was written by Devin, from one Slack request plus one follow-up for the review fixes. I reviewed every PR and merged them in order.

## Inputs (written by me, committed before the run)
- **AGENTS.md:** stack, layout, controls, PR rules, and how to work from a Slack request.
- **SPEC.md:** what to build, the rules R1–R11, the demo steps and the backlog.
- **BUSINESS_RULES.md:** the dispute domain for an issuer-processor, adapted from a disputes tool I built for a Series C issuer-processor in Argentina.
- **DESIGN.md:** the UI brief.

## The request
Posted in Slack (#internal-tools) on October 21, 2026 at 16:08 (UTC−3):

> @Devin The disputes team needs a chargebacks manager: one place to work the disputes our clients send us, from the daily file to the final decision, with approvals on the money decisions. Please build it in pedromarotta/chargebacks-manager; everything you need is in the repo docs. Post your plan here first, then keep us posted in this thread.

## Timeline (UTC−3)
| Time | What happened |
|---|---|
| 16:08 | Request posted |
| 16:09 | Devin replied and started reading the repo docs, then posted its plan in the thread |
| 16:23 | **#1 core** opened: import, queue, case workflow, maker-checker approvals, history, CI (15 minutes) |
| 16:27 | #2 fight-or-accept helper |
| 16:28 | #3 metrics page |
| 16:31 | #4 evidence file attachments |
| 16:35 | #5 pre-arbitration memo |
| 16:37 | #6 bulk write-off |
| 16:39 | #7 CSV export (auditors) |
| 16:41 | #8 card number audit |
| 16:43 | #9 due-soon digest |
| 16:47 | #10 lifecycle timeline, with the rejected-filing path |
| 16:51 | #11 funds tracking, with maker-checker on money moves |
| 16:53 | #12 network outbox |
| 16:54 | Final summary in Slack: core plus all 11 backlog items, CI green on every PR (**46 minutes** in total) |
| 17:51 | #13 review fixes (see below) |
| 18:35 | I merged #1–#13 into main, in order |

## Results
- **13 PRs**, each with CI (lint, typecheck, tests, build) green, merged into main.
- **93 tests**, one or more per rule, including a positive control for maker-checker.
- **Cost:** one day of the Pro plan's included quota, plus **$6.17** of on-demand usage.

## Review
- **Devin Review on #1** raised 8 findings: 5 possible bugs and 3 security points.
- **Devin fixed two of them by itself** while building #8 (the card number audit). A full card number is now refused in notes and merchant responses, and the history masks card numbers as a backstop. The audit also caught a real leak: a card number in an import filename was being copied into the history.
- **My own review of #12** found two UI issues: the first sign-in didn't refresh the page, and an analyst's refusal read "Your role can't do this."
- **One Slack message** asked Devin to close the remaining findings and my two issues. **#13** fixed:
  - merchant responses for existing cases (a gap in my SPEC; Devin updated R10);
  - the amount limit;
  - calendar-date validation;
  - the Secure cookie;
  - the sign-in refresh;
  - the refusal wording.

  Devin replied on every Devin Review comment, and left two unchanged with reasons.

## What isn't done, or isn't real
- **Simulated:** the card network (and its rulings), sign-in (a dev user switcher), and all the data.
- **Not built:** a real identity provider, deployment, email, and AI features.
- **Assumptions to confirm:**
  - The funds-tracking limits are the illustrative ones from BUSINESS_RULES §5 and need checking with legal.
  - Each case defaults to the US jurisdiction.
  - Only USD amounts are accepted: the $500 threshold is defined for USD only, so other currencies are rejected at import.
- **Left as is:**
  - The History page shows the latest 1,000 rows. Nothing is deleted, and each case page shows its full history.
  - Malformed requests are refused before any action, so they leave no history row.
- **Dependencies beyond AGENTS.md:** `tsx` (scripts) and `sonner` (toasts), plus what shadcn's setup installs. Devin raised them in Slack.
