---
name: trello-implement-card
description: >
  Implement a ready-specced Trello card by handing its context to
  /skill:implement. Use when the user asks to implement a Trello card; route
  requests to clarify or flesh out the card to trello-spec-card.
---

# Trello Implement Card

Pass Trello context through to `/skill:implement` while leaving implementation
method and Trello writes with their respective owners.

## 1. Fetch Trello context

Parse the short link from `/c/SHORTLINK`. Use `/trello-cli` for command syntax,
JSON handling, and Trello error rules. Fetch:

- `data.id` — full card ID for any later Trello update
- `data.name` — card title
- `data.desc` — active spec or ticket body
- `data.url` — card URL for reporting

Fetch comments or attachments when the card description or user request makes
them part of the implementation context. Represent each requested source as
readable content, preserved metadata plus an explicit read failure, or
`(none)`.

If the card has no useful description, ask whether to use
`trello-spec-card` first or proceed from the title alone.

This step is complete when all four card fields and every requested additional
source are accounted for.

## 2. Prepare a verbatim handoff

Pass the active card body verbatim as the implementation source of truth.
Preserve its document shape instead of constructing a second requirements
model. Classification and spec rewriting remain outside this adapter.

When the description contains historical notes after a separator such as
`---` / `## Original notes`, label that block as background while keeping the
active spec or ticket authoritative.

## 3. Delegate implementation

Delegate to `/skill:implement` with this multiline context:

```markdown
Implement this Trello card.

Card: <data.name>
URL: <data.url>
ID: <data.id>

Spec/ticket body:
<data.desc verbatim>

Additional Trello context, if fetched:
<comments, attachments, read failures, or "(none)">

Use the card body as the source of truth. Treat labelled historical notes as
background only.
```

If the tool reports that `/skill:implement` is unavailable, relay its
installation error. After it queues successfully, end this turn. The hidden
skill owns repository exploration, TDD, verification, review, commits, and its
final implementation report.

## 4. Keep Trello read-only by default

A completed implementation leaves Trello unchanged. When the user explicitly
requests a move, comment, or description edit, use the full card ID and
`/trello-cli` for that operation. Check its JSON response and report any
`ok: false` error.
