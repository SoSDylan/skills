---
name: trello-spec-card
description: >
  Spec a Trello card through /skill:grill-with-docs and /skill:to-spec, then
  publish the exact approved artifact. Use when the user wants to clarify,
  flesh out, or make a Trello card pickup-ready; route implementation requests
  to trello-implement-card.
---

# Trello Spec Card

Orchestrate clarification and drafting while retaining ownership of the
canonical Trello publication artifact.

## 1. Fetch and normalize Trello context

Parse `SHORTLINK` from `/c/SHORTLINK`. Use `/trello-cli` for commands, JSON
handling, and errors. Fetch:

- card fields: `data.id`, `data.name`, `data.desc`, `data.url`
- comments
- attachment metadata and safely readable local or visible content

Represent every attachment as readable content or preserved metadata plus an
explicit read failure.

Normalize the description before delegating. The canonical history delimiter
is the exact string `"\n\n---\n\n## Original notes\n\n"`.

- With no delimiter, set `active_desc` and `original_notes` to `data.desc`.
- With exactly one delimiter, split on it: `active_desc` is the content before
  the delimiter and `original_notes` is the content after it. This is a
  revision of an existing canonical spec; preserve that historical payload
  instead of nesting the whole previous description again.
- With more than one delimiter, stop and ask which historical block to preserve
  rather than guessing through nested or ambiguous history.
- With an empty description, both values are empty.

Pass `active_desc` as current card intent and label `original_notes` as
historical context. This step is complete when all fetched sources are
accounted for and the description has one unambiguous active body and at most
one preserved historical payload.

## 2. Clarify intent with `/skill:grill-with-docs`

Delegate to `/skill:grill-with-docs` with all normalized Trello context plus
these instructions:

- clarify intent, project vocabulary, implementation decisions, and testing
  seams for a pickup-ready spec while leaving Trello unchanged
- own the interview, code and docs checks, glossary updates, and ADR suggestions
- get explicit agreement on testing seams before drafting
- treat `original_notes` as background and `active_desc` as current intent
- after the understanding is resolved, delegate exactly once to
  `/skill:to-spec` for the drafting stage below

Tell `/skill:grill-with-docs` to delegate to `/skill:to-spec` with this input:

```text
Draft a pickup-ready Markdown spec for the Trello card established in this
conversation. The interview and testing-seam agreement are complete. Synthesize
the normalized card context and resolved understanding without further
questions. Return only the proposed spec Markdown. Leave trackers and files
unchanged. Omit "Original notes" because the Trello adapter owns historical
preservation and publication.
```

Supply this exact continuation to that delegation:

```text
Resume the active trello-spec-card workflow at step 4. The immediately
preceding assistant response is the to-spec result; treat its entire
Markdown response as the proposed spec. Build and validate
/tmp/trello-spec-<SHORTLINK>.md using the Trello metadata, active_desc, and
original_notes already established in this conversation, then follow steps
5-7. Continue directly at step 4 because clarification and drafting are
complete. Trello publication remains owned by trello-spec-card and requires
explicit approval of the exact canonical file.
```

If either hidden skill is unavailable, relay its installation error. After
`/skill:grill-with-docs` queues, end this turn so its interview can proceed.

## 3. Complete the drafting handoff

The final grilling turn queues `/skill:to-spec` with the continuation. A
continuation keeps that delegated run read-only, preventing it from publishing
or mutating files. When drafting ends, the bridge queues the continuation that
returns control here at step 4.

Wait for that continuation. The immediately preceding response must be proposed
Markdown rather than a question, explanation, or error; otherwise report that
drafting failed.

## 4. Build and validate the canonical artifact

Write the proposed spec to `/tmp/trello-spec-<SHORTLINK>.md`. When
`original_notes` is non-empty, append it once at the bottom:

```markdown

---

## Original notes

<original_notes exactly>
```

The resulting file is the sole approval and publication artifact. Count Unicode
characters in the complete file:

```bash
SPEC_FILE="/tmp/trello-spec-<SHORTLINK>.md"
CHAR_COUNT=$(wc -m < "$SPEC_FILE" | tr -d '[:space:]')
printf '%s\n' "$CHAR_COUNT"
```

The maximum is **16,384 characters**. Shorten only the proposed spec until it
fits, preserving `original_notes` exactly. If the historical payload leaves no
room for a useful spec, explain the conflict and ask the user how to preserve
it.

This step is complete when the file contains the full proposal, contains zero
or one historical block, preserves its payload exactly, and is at most 16,384
Unicode characters.

## 5. Show and approve the exact artifact

Read and show the entire canonical file, then compute its SHA-256 digest:

```bash
shasum -a 256 "/tmp/trello-spec-<SHORTLINK>.md"
```

Ask for explicit approval of that exact content and digest. Requested changes
produce a rewritten file, a repeated character check, a full redisplay, a new
digest, and fresh approval.

Approval is complete when the user approves the entire displayed file and its
recorded digest.

## 6. Publish the approved artifact

Recompute the digest immediately before publication and compare it with the
approved digest. A mismatch returns to step 5. When it matches, pass the file
contents directly to `/trello-cli` using the full card ID:

```bash
SPEC_FILE="/tmp/trello-spec-<SHORTLINK>.md"
trello-cli --update-card "<data.id>" --desc "$(<"$SPEC_FILE")"
```

Check the JSON response. If `ok: false`, report the error and show the canonical
file so the user can paste it manually. On success, fetch the card description
again and compare it exactly with the canonical file; report any mismatch while
retaining the file as the approved recovery artifact.

## 7. Confirm

Report the card title, Trello URL, canonical file path, approved digest, and
successful publication. The workflow is complete when Trello contains the same
byte-for-byte artifact the user approved.
