# Trello Product Follow-Up

Use this branch only after the user chooses product follow-up for the assessed
Zendesk ticket. Capture problem framing rather than a full implementation spec;
a later workflow can load the resulting card through `trello-card-context`.

## 1. Prepare the card

Use this title:

```text
[Zendesk #<id>] <concise customer-visible symptom>
```

Include only relevant sections:

- Zendesk link
- Problem
- Customer impact
- Expected behavior
- Actual behavior
- Reproduction
- Evidence
- Cause
- Workaround
- Open questions

Summarize the evidence needed to understand the problem. Keep the full customer
conversation and implementation planning out of the card.

This step is complete when every card claim is supported by the assessment's
evidence ledger and the description contains problem framing rather than a
specification.

## 2. Select the destination

Use `/trello-cli`. Select the board automatically when only one is available;
otherwise ask the user to choose. Show the selected board's open lists and ask
which list should receive the card.

## 3. Check for duplicates

Search the selected board by Zendesk ID, ticket URL, proposed title, and problem
wording. Show likely duplicates and pause for the user's decision. Existing
cards remain unchanged unless the user starts a separate update request.

## 4. Approve the external write

Show the exact proposed title, description, requester, board, and list. Ask for
explicit approval of that complete artifact. Any requested change produces a
new complete preview and approval round.

## 5. Create the approved card

Create exactly the approved card through `/trello-cli` and verify `ok: true`.
Resolve the parent `zendesk-triage-ticket` skill directory to an absolute path,
then run the requester helper:

```bash
node "<zendesk-triage-ticket-skill-dir>/scripts/trello-requester.mjs" <board-id> <card-id> <requester-name>
```

The helper sets the customer's display name in the text custom field named
`Requester` when available. An absent field needs no further action. If the
helper fails after card creation, retain the created card and report partial
success; card creation is not retried automatically.

This branch is complete when the approved card exists once, its URL is
reported, and any requester-field failure is explicit.
