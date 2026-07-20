---
name: trello-spec-card
description: >
  Fetch a Trello card, gather its Trello context, run /skill:grill-with-docs to
  clarify intent, delegate spec writing to /skill:to-spec, save and validate the proposed spec,
  then publish the approved file back to the same card. Use when the user wants
  to spec, flesh out, or make a Trello card ready for agent implementation. Do
  not use for implementation; use trello-implement-card instead.
---

# Trello Spec Card

Thin Trello adapter around `/skill:grill-with-docs` and `/skill:to-spec`.

## Workflow

### 1. Fetch Trello context

Parse `SHORTLINK` from `/c/SHORTLINK`. Read `/trello-cli` and use it for commands,
JSON handling, and errors. Fetch:

- Card fields: `data.id`, `data.name`, `data.desc`, `data.url`
- Comments
- Attachment metadata and any safely readable local/visible content

Preserve each attachment's name and readable content.
Explicitly note read failures; never silently drop attachments.

### 2. Clarify intent with `/skill:grill-with-docs`

Delegate to the hidden `/skill:grill-with-docs` skill in standard mode with all
fetched Trello context plus these instructions:

- clarify intent, project vocabulary, implementation decisions, and testing
  seams for a pickup-ready spec without updating Trello
- own the interview, code/docs checks, glossary updates, and ADR suggestions
- get explicit agreement on the testing seams before drafting
- when the understanding is resolved, delegate exactly once to the hidden
  `/skill:to-spec` skill for the drafting stage below; do not draft or publish
  the spec itself

Tell `/skill:grill-with-docs` to make that `/skill:to-spec` delegation in `draft-only` mode
with this context:

  ```text
  Draft a pickup-ready Markdown spec for the Trello card already established in
  this conversation. The interview and testing-seam agreement are complete.
  Synthesize the fetched card context and resolved understanding; do not ask
  more questions. Return only the proposed spec Markdown. Do not publish,
  create or update tracker items, or write files. Omit any "Original notes"
  section because the Trello adapter appends the source description unchanged.
  ```

After `/skill:to-spec` finishes, resume this adapter with this exact continuation:

  ```text
  Resume the active trello-spec-card workflow at step 4. The immediately
  preceding assistant response is the draft-only to-spec result; treat its
  entire Markdown response as the proposed spec. Build and validate the
  canonical /tmp/trello-spec-<SHORTLINK>.md file using the Trello card metadata
  and unchanged original description already in this conversation, then follow
  steps 5-7. Do not invoke grill-with-docs or to-spec again. Trello publication
  remains owned by trello-spec-card and still requires explicit approval of the
  exact canonical file.
  ```

If either hidden skill is unavailable, stop and relay the installation error.
After the `grill-with-docs` invocation queues, end this turn so its interview can
proceed.

### 3. Draft-only handoff and continuation

The final grilling turn queues `/skill:to-spec`. `draft-only` mode allows only
read-only tools during that hidden-skill run, so `/skill:to-spec` cannot publish to another
tracker or mutate files. When that run ends, the bridge queues the exact
continuation above, which returns control to this adapter at step 4.

Do not continue to step 4 before receiving that continuation. If the preceding
`/skill:to-spec` response is not a proposed Markdown spec, stop and explain that drafting failed
instead of treating prose, a question, or an error as the canonical draft.

### 4. Build and validate the canonical file

Write the proposed spec from the immediately preceding `/skill:to-spec` response to
`/tmp/trello-spec-<SHORTLINK>.md`. If the original
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
