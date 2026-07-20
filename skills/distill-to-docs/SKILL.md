---
name: distill-to-docs
description: >
  Distill non-derivable session lessons into project agent docs. Use when the
  user asks to capture session learnings, corrects the agent's approach,
  reveals a hidden project constraint, or several such lessons accumulate.
---

# Distill Session Lessons

Turn hidden project lessons from the current session into concise,
approval-gated agent documentation.

## 1. Discover documentation ownership

Locate the repository's existing root `AGENTS.md` and `CLAUDE.md` files and
any scoped agent docs relevant to the session. Read them and follow their
pointers. Identify which file owns repository-wide workflow rules and which
scoped files own the areas discussed in the session.

This step is complete when every relevant existing agent doc has a known scope
and owner, including the case where no suitable doc exists.

## 2. Gather candidate lessons

Scan the current conversation for knowledge a future agent could not reliably
derive by exploring the repository:

- corrections that changed the agent's approach
- commands the agent got wrong or had to ask about
- hidden workflow ordering constraints
- project-specific conventions that are not visible in code
- gotchas or behaviours revealed by the user

Retain a candidate only when it is project-specific, likely to recur, and
non-derivable from code or ordinary repository exploration. File structure,
API shapes, component names, and visible code conventions remain discoverable
and are not session lessons.

This step is complete when every candidate has passed or failed all three
filters: project-specific, recurring, and non-derivable.

## 3. Check existing documentation and enforcement

Search the discovered agent docs for each retained candidate. When project
Claude settings exist, or a candidate concerns hook behaviour, read the
project's `.claude/settings.json` and the hook scripts it references.

Classify every candidate as one of:

- already documented
- already enforced by a hook
- undocumented
- stale enforcement whose hook message or command needs correction

Only undocumented lessons and stale enforcement proceed. This step is complete
when every retained candidate has exactly one classification.

## 4. Choose one target per finding

Assign each finding to its single owner discovered in step 1:

- repository-wide workflow or tooling lessons → the root doc that owns them
- app- or package-specific lessons → the nearest relevant scoped doc
- stale hook commands or messages → the enforcing hook script
- no suitable existing owner → a clearly identified proposed agent doc

This step is complete when every finding has exactly one target file.

## 5. Preview and obtain approval

Show approximate diffs grouped by target file. Include the exact proposed
wording, with one concise bullet or short sentence per lesson. Include any hook
correction in the same preview.

Ask the user to confirm, edit, or drop the proposed changes. Approval applies
only to the exact current preview; requested changes produce a new preview and
approval round.

This step is complete only when the user explicitly approves the current
preview.

## 6. Apply the approved lessons

Place each approved item under the most relevant existing heading, or add a
focused heading when needed. Preserve unrelated content and formatting.

Finish when every approved item appears exactly once in its approved target,
no unapproved item was written, and the changed file paths have been reported
to the user.
