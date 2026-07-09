---
name: trello-spec-card
description: >
  Fetch a Trello card by URL, run grill-with-docs to flesh it out with the user,
  then write the approved spec back to the card. Use when the user wants to spec,
  grill, flesh out, or make a Trello card ready to pick up. Do not use for
  implementation; use trello-implement-card instead.
---

# Trello Spec Card

Owns Trello fetch/update and final spec publishing. Delegates all grilling to
`grill-with-docs`.

## Workflow

### 1. Fetch the card and attachments

Parse the short link from `/c/SHORTLINK`, then run:

```bash
trello-cli --get-card <SHORTLINK>
trello-cli --get-comments <SHORTLINK>
trello-cli --list-attachments <SHORTLINK>
```

Keep `data.id`, `data.name`, `data.desc`, and `data.url` from the card, and
keep every attachment's `id`, `name`, `url`, `mimeType`, `bytes`, `isUpload`, and
`fileName`.

Download and read every attachment before grilling:

1. Create a temporary attachment directory, e.g. `/tmp/trello-card-<SHORTLINK>-attachments/`.
2. For uploaded Trello attachments (`isUpload: true`), download the `url` with
   Trello auth. `trello-cli` does not download attachments directly; use the
   same credentials from `TRELLO_API_KEY` / `TRELLO_TOKEN` or the saved
   `~/.trello-cli/config.json` without printing secrets.

   ```bash
   curl -fL \
     -H "Authorization: OAuth oauth_consumer_key=\"$TRELLO_API_KEY\", oauth_token=\"$TRELLO_TOKEN\"" \
     -o "/tmp/trello-card-<SHORTLINK>-attachments/<safe-file-name>" \
     "<attachment.url>"
   ```

3. For URL attachments (`isUpload: false`), fetch/read the URL if it is directly
   accessible; otherwise preserve the URL and note that it could not be read.
4. Read downloaded files according to type:
   - Images: use the `read` tool on the image file and capture the visible
     requirements/design details.
   - Plain text/Markdown/JSON/CSV/code: read the text directly.
   - PDFs/docs/spreadsheets: extract text with available local tools
     (`pdftotext`, `textutil`, `python`, etc.) and summarize any relevant tables
     or screenshots.
   - Unknown/binary files: record metadata and any read/extraction failure.

If any attachment cannot be downloaded or read, continue, but include the failure
in the grill context as an attachment note/open dependency. Do not silently ignore
attachments.

### 2. Run `grill-with-docs`

Delegate to the `grill-with-docs` skill by name.

Pass this context into the grill:

```markdown
We are turning this Trello card into a pickup-ready spec.

Card: <data.name>
URL: <data.url>
Description:
<data.desc or "(empty)">
Comments:
<comments or "(none)">

Attachments:
<for each attachment: name, mimeType, bytes, source URL, local path if downloaded,
and extracted text or visual summary; include download/read failures explicitly;
use "(none)" if there are no attachments>

Need resolved: scope, acceptance criteria, decisions, out of scope, dependencies,
and real open questions.

Do not update Trello. Return here for synthesis and publishing.
```

### 3. Write the spec

After the grill, synthesise:

```markdown
## What to build

<end-to-end behaviour and intent>

## Acceptance criteria

- [ ] <testable criterion>

## Context & decisions

- <decision and why>

## Out of scope

- <excluded item> <!-- omit if empty -->

## Blocked by / dependencies

- <dependency, or "None — can start immediately">

## Open questions

- <unresolved question> <!-- omit if empty -->
```

### 4. Get approval

Show the user the spec summary and ask whether to write it to Trello.

Do not update the card until the user explicitly approves the current version. If
they request changes, revise, show it again, and ask again.

### 5. Update Trello

Use the full card ID, not the short link:

```bash
trello-cli --update-card <data.id> --desc "<spec>"
```

If the original description was non-empty, append it below the spec:

```markdown
---

## Original notes

<original data.desc exactly>
```

### 6. Confirm

Say the card name, that the spec was written, open-question count, and `data.url`.

## Errors

- If fetch/update/list-attachments returns `ok: false`, report the error.
- If an attachment cannot be downloaded or read, report which attachment failed
  and why; include that in the grill context instead of dropping it.
- If update fails, print the full spec so the user can paste it manually.
