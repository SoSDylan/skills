---
name: trello-spec-card
description: >
  Fetch a Trello card, gather its Trello context, run /grill-with-docs to clarify
  intent, delegate spec writing to /to-spec, save and validate the proposed spec,
  then publish the approved file back to the same card. Use when the user wants
  to spec, flesh out, or make a Trello card ready for agent implementation. Do
  not use for implementation; use trello-implement-card instead.
---

# Trello Spec Card

Thin Trello adapter around `/grill-with-docs` and `/to-spec`.

## Workflow

### 1. Fetch Trello context

Parse `SHORTLINK` from `/c/SHORTLINK`. Read `/trello-cli` and use it for commands,
JSON handling, and errors. Fetch:

- Card fields: `data.id`, `data.name`, `data.desc`, `data.url`
- Comments
- Attachment metadata and any safely readable local/visible content

Preserve each attachment's name and readable content.
Explicitly note read failures; never silently drop attachments.

### 2. Clarify intent with `/grill-with-docs`

Pass the fetched context to `/grill-with-docs` and ask it to clarify intent,
project vocabulary, and decisions for a pickup-ready spec without updating
Trello. Let it own the interview, code/docs checks, glossary updates, and
ADR suggestions.

### 3. Draft with `/to-spec`

Pass `/to-spec` all fetched context and the resolved understanding. Tell it to:

- target this same Trello card
- return only the proposed pickup-ready markdown spec
- not update Trello
- omit `Original notes`; this adapter adds them from the source

### 4. Build and validate the canonical file

Write the proposed spec to `/tmp/trello-spec-<SHORTLINK>.md`. If the original
card description is non-empty, append it unchanged at the very bottom as:

```markdown

---

## Original notes

<original data.desc exactly>
```

This is the canonical approval and publication artifact. Never publish a
reconstructed copy. Count Unicode characters in the complete file, including
original notes, rather than counting bytes:

```bash
SPEC_FILE="/tmp/trello-spec-<SHORTLINK>.md"
CHAR_COUNT=$(wc -m < "$SPEC_FILE" | tr -d '[:space:]')
printf '%s\n' "$CHAR_COUNT"
```

Maximum: **16,384 characters**. If greater, shorten the spec without changing
the original notes, rewrite the same file, and repeat the check until it fits.
If unchanged original notes leave no room for a useful spec, explain the
conflict and ask how to preserve them. Never show an oversized proposal for
approval.

### 5. Show and approve

After validation, read the canonical file and show its **entire exact contents**
not only a summary or path—so the user can read it. Ask for explicit approval
of that exact markdown.

For requested changes, update the same file, check its length again, and show
the entire file again. Any change invalidates prior approval. Do not alter the
file after approval.

### 6. Publish the approved file

Use full card ID `data.id`. Use Bash to pass the canonical file contents
directly to `/trello-cli` without regenerating or manually copying the
description:

```bash
SPEC_FILE="/tmp/trello-spec-<SHORTLINK>.md"
trello-cli --update-card "<data.id>" --desc "$(<"$SPEC_FILE")"
```

Check the JSON response. If `ok: false`, report the error and show the entire
canonical file so the user can paste it manually.

### 7. Confirm

Report the card title, Trello URL, canonical file path, and that the approved
file was written to the card description.
