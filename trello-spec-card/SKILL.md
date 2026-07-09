---
name: trello-spec-card
description: >
  Fetch a Trello card, gather its Trello context, run /grill-with-docs to clarify
  intent, delegate spec writing to /to-spec, then publish the approved spec back
  to the same Trello card. Use when the user wants to spec, flesh out, or make a
  Trello card ready for agent implementation. Do not use for implementation; use
  trello-implement-card instead.
---

# Trello Spec Card

Thin Trello adapter around `/grill-with-docs` and `/to-spec`.

This skill owns only:

- what Trello context to fetch
- how to publish the approved result back to Trello

It must not maintain its own spec template, grilling flow, or card-breakdown
method. Delegate intent discovery to `/grill-with-docs`, delegate spec writing to
`/to-spec`, and read `/to-tickets` for the project's ticket/blocking-edge
document conventions when ticket-shaped output is relevant.

## Workflow

### 1. Fetch Trello context

Parse the short link from `/c/SHORTLINK`.

Use the `/trello-cli` skill for command syntax, JSON handling, and Trello error
rules. Fetch:

- Card fields: `data.id`, `data.name`, `data.desc`, `data.url`
- Comments
- Attachment list/metadata

For attachments, preserve name, URL, MIME type, size, upload-vs-URL status, and
any local/visible content you can safely read with available tools. If an
attachment cannot be read, keep the metadata and note the failure explicitly.
Do not silently drop attachments.

### 2. Clarify intent with `/grill-with-docs`

Before writing the spec, run `/grill-with-docs` with the fetched Trello context
so the agent understands the card, the user's intent, project vocabulary, and any
important decisions.

Pass this context into `/grill-with-docs`:

```markdown
We are turning this Trello card into a pickup-ready spec.

Trello card:
- ID: <data.id>
- Title: <data.name>
- URL: <data.url>

Current description:
<data.desc or "(empty)">

Comments:
<comments or "(none)">

Attachments:
<metadata plus extracted/readable content or explicit read failures; "(none)" if none>

Goal: clarify the user's intent and any project/domain decisions needed before
writing the spec. Do not update Trello. Return the resolved understanding here
for `/to-spec`.
```

Let `/grill-with-docs` own the interview, code/docs checks, glossary updates,
and ADR suggestions. Do not duplicate its questioning method here.

### 3. Delegate spec writing

Before drafting, read the `/to-spec` skill instructions and the `/to-tickets`
skill instructions. Use their document shapes and vocabulary instead of defining
a Trello-specific spec format here.

Pass `/to-spec` the fetched Trello context plus the resolved understanding from
`/grill-with-docs`, and make the publish target explicit:

```markdown
Turn this Trello card context and clarified intent into a pickup-ready spec.

Trello card:
- ID: <data.id>
- Title: <data.name>
- URL: <data.url>

Current description:
<data.desc or "(empty)">

Comments:
<comments or "(none)">

Attachments:
<metadata plus extracted/readable content or explicit read failures; "(none)" if none>

Clarified intent from `/grill-with-docs`:
<resolved understanding, decisions, terminology, open questions, and any docs/ADR updates>

Publish target: this same Trello card. Return the final markdown spec here for
Trello publishing; do not update Trello directly.
```

Let `/to-spec` own synthesis, seams, wording, scope, and approval checks.

### 4. Publish to Trello after approval

Only update Trello after the user has explicitly approved the exact markdown to
publish.

When publishing:

- Use the full card ID (`data.id`), not the short link.
- Use `/trello-cli` for the update command.
- Replace the card description with the approved spec.
- If the original description was non-empty and is not already preserved in the
  approved spec, append it under:

```markdown
---

## Original notes

<original data.desc exactly>
```

Check the Trello command response. If it reports `ok: false`, report the error
and print the full markdown so the user can paste it manually.

### 5. Confirm

Report the card title, Trello URL, and that the approved spec was written.
