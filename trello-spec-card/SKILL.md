---
name: trello-spec-card
description: >
  Fetch a Trello card by URL, grill the user interactively one question at a time
  (scope, acceptance criteria, unknowns, dependencies, edge cases — exploring the
  codebase to answer what it can), then synthesise the answers into a clean,
  ready-to-work spec and write it back as the card description. Activate when the
  user pastes a Trello card link and wants to BE grilled on it, talk it through, or
  turn it into a pickup-ready brief — phrases like "spec this card", "grill me on
  this card", "let's flesh this card out", "make this card ready to pick up". Do NOT
  use for silently dumping questions onto a card (that's trello-grill-card) or for
  doing the implementation work (that's trello-implement-card).
---

# Trello Spec Card

Grill the user live about a Trello card, then turn the conversation into a ready-to-work spec on the card.

This is the **interactive** counterpart to `trello-grill-card`: that skill silently writes
*questions* for others to answer later; this one *interviews the user now* and writes the
*resolved answers* as a spec a human can pick up cold.

## Workflow

### 1. Parse the card URL

The short link is the path segment immediately after `/c/`:

```
https://trello.com/c/SHORTLINK/optional-card-name
                      ^^^^^^^^ ← short link
```

### 2. Fetch the card and its context

```bash
trello-cli --get-card <SHORTLINK>      # data.id, data.name, data.desc
trello-cli --get-comments <SHORTLINK>  # prior discussion, if any
```

Keep `data.id` (full card ID — needed to update), `data.name`, and `data.desc` (the original, to preserve).

### 3. Explore the codebase

Before grilling, understand the current state of the code so questions are sharp and the
final spec uses the project's real vocabulary. Read `CONTEXT.md` / `CONTEXT-MAP.md` and any
`docs/adr/` if present (see `grill-with-docs` for the conventions). **If a question can be
answered by reading the code, answer it yourself instead of asking.**

### 4. Grill the user — one question at a time

Interview relentlessly until you reach a shared understanding the work could be picked up from.
Walk each branch of the decision tree, resolving dependencies between decisions one by one.

- **Ask ONE question, wait for the answer, then ask the next.** Never batch.
- For every question, give your **recommended answer** so the user can just confirm.
- Cover the angles that actually apply to this card; skip the rest:
  - **Scope** — what's in, what's explicitly out, the smallest shippable version.
  - **Acceptance criteria** — how we'll know it's done; concrete, testable.
  - **Behaviour & edge cases** — "What happens when the user has no active subscription?" beats "what are the edge cases?".
  - **Data & contracts** — inputs/outputs, format, source, validation.
  - **Dependencies & blockers** — what must exist first; other teams/cards.
  - **Unknowns** — anything the user can't answer yet (these become Open questions, not blockers to the grill).
- Challenge fuzzy or overloaded terms against `CONTEXT.md`; propose a precise canonical term.
- If the user's answer contradicts the code, surface it: "Your code does X, but you just said Y — which is right?"

Stop when the remaining unknowns are genuinely things no one can answer yet, not things you haven't asked.

### 5. Synthesise the spec

Turn the resolved conversation into the template below. Describe end-to-end behaviour, not
layer-by-layer implementation. Avoid specific file paths and code snippets — they go stale.
The **Context & decisions** section is the payoff: it captures *why* each call was made so the
person picking this up doesn't have to re-litigate it.

```
## What to build

<concise description of the end-to-end behaviour and intent>

## Acceptance criteria

- [ ] <concrete, testable criterion>
- [ ] <criterion>

## Context & decisions

- <decision made during the grill, and the reasoning behind it>
- <constraint, domain term, or assumption that was nailed down>

## Out of scope

- <thing explicitly excluded> (omit this section if nothing was excluded)

## Blocked by / dependencies

- <what must exist first, or "None — can start immediately">

## Open questions

- <anything genuinely unresolved> (omit this section if there are none)
```

### 6. Review with the user

Print a brief summary of the spec: card name, the "What to build" section, and acceptance criteria count.
Ask the user if they want any changes before writing it to Trello.

**Never write to the card until the user has given explicit approval in direct response to the
current version of the spec.** Treat this as a loop, not a one-time gate:

- If they want changes, iterate on the spec, re-show the updated version, and ask for approval
  again. A request for changes is *not* approval — making the edits does not grant permission to
  write. Every change resets the approval; you must ask again after each one.
- Only proceed to step 7 when the user explicitly confirms the spec as currently shown (e.g.
  "yes", "write it", "looks good — push it"). If their reply contains both a change and what could
  be read as approval, treat it as a change request: apply it, re-show, and ask again.
- If you are unsure whether what they said counts as approval, do not write — ask.

### 7. Write the spec back to the card

Only after explicit approval in step 6.

Replace the description with the spec, preserving the original at the bottom so nothing is lost:

```
<the synthesised spec>

---

## Original notes

<the original data.desc, exactly as it was — omit this whole block if the card had no description>
```

Then update using the full card **id** from step 2 (not the short link):

```bash
trello-cli --update-card <full-card-id> --desc "<spec + original notes>"
```

### 8. Confirm

One sentence: the card name, that the spec was written, and the count of any Open questions left. Include the card URL from `data.url` so the user doesn't have to scroll back to find it.

## Error handling

- If `--get-card` or `--update-card` returns `ok: false`, report the error. On update failure,
  print the full spec in the chat so the user can paste it manually.
- If the user pastes a card link but clearly wants questions written *for someone else* (not to be
  grilled themselves), hand off to `trello-grill-card` instead.
