---
name: trello-implement-card
description: >
  Fetch a Trello card that has been prepped with answered Q&A sections (by trello-grill-card),
  synthesise the requirements from all three answer sections (client, management, developers),
  then implement the work. Activate when the user pastes a Trello card URL and wants to do the
  work — phrases like "implement this", "do this card", "work on this", "ship this", or just
  pasting a URL after the grill/answer step. Do NOT activate for grilling or prepping cards —
  that's trello-grill-card's job.
---

# Trello Implement Card

Fetch an answered Trello card and implement the described work.

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
- `data.desc` — description (contains original spec + Q&A)

### 3. Parse the description

Split the description on the `---` separator.

- **Above `---`**: original spec / feature description
- **Below `---`**: Q&A block with three sections

Extract answers from each section heading:
- `**For the client:**` → UX intent, business goals, success criteria
- `**For management:**` → scope boundaries, constraints, priorities
- `**For developers:**` → technical decisions, API contracts, edge cases

Each answer follows its question as `**Answer:** <text>`. An answer is blank if it's empty or only whitespace after the colon.

### 4. Check answers before proceeding

Tally blank answers per section. If **all answers in any section are blank**, warn the user:

> "The [section] questions have no answers yet. Proceeding without them risks wrong scope/implementation. Continue anyway?"

A partially answered section is fine — proceed. Only halt on a completely empty section, since that usually means a stakeholder hasn't been consulted at all.

Developer answers are the highest-stakes for implementation correctness. Flag those missing most loudly.

### 5. Synthesise requirements

Before touching code, form a clear internal picture:

- **What**: original spec + client answers define the feature intent
- **Boundaries**: management answers define what's in/out of scope
- **How**: developer answers define architecture, data contracts, and edge cases to handle

If answers contradict the spec, prefer the answers — they represent later, more specific decisions.

### 6. Explore before implementing

Read `CLAUDE.md` at the project root (if it exists) for conventions. Then explore the relevant parts of the codebase to understand:
- Where the change belongs
- Existing patterns to follow
- What not to break

Don't guess at structure — look it up first.

### 7. Implement

Do the work. Follow project conventions. Make the changes.

If an assumption had to be made due to a missing or ambiguous answer, note it — don't silently guess and move on.

### 8. Report

When done, tell the user:
- What was changed (files + brief description)
- Any assumptions made where answers were missing or unclear

Keep it tight — no padding.

## Error handling

- `--get-card` returns `ok: false` → report the error, stop.
- Description has no `---` separator → treat the whole description as the spec, skip Q&A parsing, proceed with just the title + spec.
- Card has no description at all → implement from the title alone, flag that there was no spec to work from.
