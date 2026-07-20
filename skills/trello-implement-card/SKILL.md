---
name: trello-implement-card
description: >
  Fetch a Trello card that contains a ready-to-work spec or ticket, then delegate
  implementation to /skill:implement. Use when the user pastes a Trello card URL and
  wants to do the work — phrases like "implement this", "do this card", "work on
  this", "ship this", or a ready-specced Trello card URL. Do NOT use when the
  user wants to flesh out/spec/grill a card first; use trello-spec-card instead.
---

# Trello Implement Card

Thin Trello adapter around `/skill:implement`.

This skill owns only:

- what Trello context to fetch
- how to hand that context to `/skill:implement`
- how to update Trello if the user explicitly asks for a Trello update

It must not parse spec sections, synthesize requirements, choose testing seams,
or maintain its own implementation method. `/skill:implement` owns the implementation
workflow.

## Workflow

### 1. Fetch Trello context

Parse the short link from `/c/SHORTLINK`.

Use the `/trello-cli` skill for command syntax, JSON handling, and Trello error
rules. Fetch the card fields needed for implementation context:

- `data.id` — full card ID, for any later Trello update
- `data.name` — card title
- `data.desc` — spec/ticket body
- `data.url` — card URL for reporting

Fetch comments or attachments only when the card description or user request
indicates they are part of the implementation context. Preserve unreadable
attachment metadata and note any read failure explicitly.

If the card has no useful description/spec, stop and ask whether to run
`/trello-spec-card` first or proceed from the title alone.

### 2. Preserve document intent without re-parsing

Do not break down the card into your own requirements model. Do not invoke
`to-spec` or `to-tickets` merely to classify the description; those are active
workflows that may publish their output.

If the description includes preserved historical notes after a separator such as
`---` / `## Original notes`, label them as historical context when passing them
to `implement`; do not let them override the active spec/ticket text.

### 3. Delegate implementation

Delegate to the hidden `/skill:implement` skill in standard mode with the following
multiline context:

```markdown
Implement this Trello card.

Card: <data.name>
URL: <data.url>
ID: <data.id>

Spec/ticket body:
<data.desc>

Additional Trello context, if fetched:
<comments, attachments, read failures, or "(none)">

Use the card body as the source of truth. If historical notes are present, treat
them as background only.
```

If the tool reports that `/skill:implement` is unavailable, stop and relay its
installation error. After it queues successfully, end this turn. The hidden
`implement` skill owns repo exploration, TDD, verification, review, commits, and
final implementation reporting.

### 4. Update Trello only when requested

Do not move, comment on, or edit the Trello card unless the user asks.

If a Trello update is requested after implementation, use the full card ID and
refer to `/trello-cli` for the appropriate update/comment/move command. Check
for `ok: false` and report any Trello error.
