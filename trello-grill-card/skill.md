---
name: trello-grill-card
description: >
  Fetch a Trello card by URL, silently generate pre-work questions about it (scope,
  acceptance criteria, unknowns, dependencies, edge cases), then write those questions
  back to the card description. Activate whenever the user pastes a Trello card link
  and wants it reviewed, grilled, or prepped for work — even if they don't say "grill".
  Also use when the user says things like "prep this card", "what do I need to figure out
  before starting this?", or "add questions to the Trello card".
---

# Trello Grill Card

Autonomously generate pre-work questions for a Trello card and append them to its description.

## Workflow

### 1. Parse the card URL

Extract the short link — the path segment immediately after `/c/`:

```
https://trello.com/c/SHORTLINK/optional-card-name
                      ^^^^^^^^ ← this is the short link
```

### 2. Fetch the card

```bash
trello-cli --get-card <SHORTLINK>
```

From the JSON response, grab:
- `data.id` — the full card ID (needed for update)
- `data.name` — card title
- `data.desc` — current description (may be empty)

### 3. Generate questions (silently — never ask the user)

Think through the card title and description as if you are a senior engineer who needs to fully understand a piece of work before starting it. Generate questions that, if left unanswered, would force you to pause mid-implementation, make risky assumptions, or deliver the wrong thing.

Generate questions across three audiences. Skip angles that obviously don't apply. Aim for 2–5 questions per section.

**For the client** — things only the client can answer:
- Business goals, priorities, success criteria
- Who the end users are and what they expect
- Existing workflows this must fit into
- Sign-off and approval process

**For management/owners** — things that need business or resource decisions:
- Scope boundaries and what's explicitly out
- Budget, timeline, or priority constraints
- Dependencies on other teams or projects
- Non-obvious business rules or compliance requirements

**For developers** — things that need technical decisions:
- Data & API contracts (inputs/outputs, format, source, validation)
- Edge cases & error states
- Architecture or design choices
- Dependencies that must exist first

Prefer concrete questions over vague ones — "What should happen when the user has no active subscription?" beats "What are the edge cases?".

### 4. Format the updated description

```
<original description — preserve exactly as-is>

---

Questions to answer before work begins:

**For the client:**

1. <question>
   **Answer:** 

2. <question>
   **Answer:** 

**For management:**

1. <question>
   **Answer:** 

2. <question>
   **Answer:** 

**For developers:**

1. <question>
   **Answer:** 

2. <question>
   **Answer:** 
```

If the original description is empty, start directly with the `---` separator and questions.

### 5. Update the card

```bash
trello-cli --update-card <full-card-id> --desc "<formatted description>"
```

Use the `id` from step 2 (not the short link).

### 6. Confirm

Tell the user: how many questions were added, and the card name. One sentence. Done.

## Error handling

- If `--get-card` returns `ok: false`, report the error and stop.
- If `--update-card` returns `ok: false`, show the formatted description in the chat so the user can copy it manually.
