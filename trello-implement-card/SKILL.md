---
name: trello-implement-card
description: >
  Fetch a Trello card that has been turned into a ready-to-work spec by trello-spec-card,
  synthesise the requirements from the spec sections, then implement the work. Activate when
  the user pastes a Trello card URL and wants to do the work — phrases like "implement this",
  "do this card", "work on this", "ship this", or just pasting a ready-specced Trello card URL.
  Do NOT activate when the user wants to flesh out/spec/grill a card first — that's
  trello-spec-card's job.
---

# Trello Implement Card

Fetch a ready-to-work Trello spec card and implement the described work.

## Workflow

### 1. Parse the card URL

Extract the short link — the segment immediately after `/c/`:

```
https://trello.com/c/SHORTLINK/optional-card-name
                      ^^^^^^^^
```

### 2. Fetch the card

```bash
trello-cli --get-card <SHORTLINK>
```

Grab from the JSON response:
- `data.id` — full card ID
- `data.name` — card title
- `data.desc` — description, expected to be the ready-to-work spec from `trello-spec-card`
- `data.url` — card URL, useful for final reporting

### 3. Parse the spec

`trello-spec-card` writes the active implementation spec at the top of the description, and preserves old notes below `---`:

```
<ready-to-work spec>

---

## Original notes

<old description>
```

Use **only the content above the first `---` as the source of truth**. Treat the preserved `Original notes` as historical context only; do not let it override the spec.

Extract these sections when present:

- `## What to build` — feature intent and end-to-end behaviour
- `## Acceptance criteria` — concrete done conditions
- `## Context & decisions` — scope decisions, constraints, assumptions, rationale
- `## Out of scope` — explicit exclusions
- `## Blocked by / dependencies` — prerequisites
- `## Open questions` — unresolved items

If the description has no `---`, treat the full description as the active spec. If the description is unstructured, still proceed from the title + description, but flag that no structured spec was found.

### 4. Check readiness

Do **not** look for Q&A answer sections; this skill consumes the final spec produced by `trello-spec-card`.

Before coding, check:

- If `## What to build` or acceptance criteria are missing, warn that the spec may be thin, then proceed unless the user asked for strict gating.
- If `## Blocked by / dependencies` names an unmet blocker, stop and ask whether to proceed anyway.
- If `## Open questions` exists, decide whether any question blocks implementation:
  - blocking or scope-changing question → ask before coding
  - non-blocking question → proceed and note the assumption in the final report

### 5. Synthesise requirements

Before touching code, form a clear internal picture:

- **What**: `What to build` + acceptance criteria define the required behaviour
- **Boundaries**: `Out of scope` and `Context & decisions` define what not to do
- **How/constraints**: `Context & decisions`, dependencies, and codebase patterns guide implementation

If the preserved original notes contradict the active spec, prefer the active spec.

### 6. Explore before implementing

Read `CLAUDE.md` at the project root (if it exists) for conventions. Then explore the relevant parts of the codebase to understand:
- Where the change belongs
- Existing patterns to follow
- What not to break

Don't guess at structure — look it up first.

### 7. Implement

Do the work. Follow project conventions. Make the changes.

If an assumption had to be made due to a missing/ambiguous spec item or non-blocking open question, note it — don't silently guess and move on.

### 8. Report

When done, tell the user:
- What was changed (files + brief description)
- Any assumptions made where the spec was missing or unclear
- Any verification run, if applicable

Keep it tight — no padding.

## Error handling

- `--get-card` returns `ok: false` → report the error, stop.
- Card has no description → implement from the title alone only if the user confirms; flag that there was no spec to work from.
- Description is only preserved `Original notes` with no active spec → treat it as unspecced and ask whether to proceed or run `trello-spec-card` first.
