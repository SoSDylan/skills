---
name: distill-to-docs
description: >
  Scans the current conversation for non-obvious commands, patterns, and corrections that
  Claude struggled with or was taught — things that can't be found by exploring the codebase —
  and appends them to CLAUDE.md or AGENTS.md. Use when the user says "update docs",
  "capture learnings", "distill this session", "add to CLAUDE.md", or after any session
  where they corrected Claude's approach or revealed non-obvious project patterns. Also
  trigger proactively when the session contained multiple corrections or moments where
  Claude had to ask about something that should have been documented.
---

# distill-to-docs

Extract session learnings into project docs so future agents don't repeat the same mistakes.

## Step 1 — Read the project doc structure

Before deciding where to write, understand how *this* project organises agent docs. Projects vary:
some use CLAUDE.md as the canonical rules file; others use it only as a pointer to AGENTS.md.

Read `CLAUDE.md` and `AGENTS.md` at the repo root. Note which file owns which kind of rule, and
discover any scoped docs that are referenced within them (e.g. per-app or per-package AGENTS.md
files relevant to the session's work).

## Step 2 — Check existing hooks

Read `.claude/settings.json` (and `~/.claude/settings.json` if relevant). Any command pattern
already blocked or redirected by a hook is already enforced — skip adding it to docs, since that
would be redundant and could create conflicting guidance.

## Step 3 — Scan the conversation for learnings

Go through the current session context. Target knowledge that is **not derivable from reading the
codebase** — file structure, API shapes, and component names are excluded because an agent can
discover those. Look for:

- User corrections ("don't do X", "use Y not Z")
- Commands Claude got wrong or had to ask about
- Workflow ordering constraints
- Import/naming conventions not visible in code
- Gotchas and non-obvious project-specific behaviours
- Things the user said that changed Claude's approach mid-task

For each candidate, check: Is this project-specific? Would a new agent hit the same issue without
this note? Is it already documented or hook-enforced? Skip it if any of those fail.

## Step 4 — Classify each finding

Based on the doc structure discovered in step 1 (not hardcoded assumptions), assign each finding
to the right file:

- Global tooling commands and agent workflow rules → whichever root file owns that kind of rule
- Codebase-wide conventions and constraints → the other root file
- Findings specific to one app or package → the nearest scoped doc for that area

## Step 5 — Propose before writing

Show the user a preview of proposed additions grouped by target file before touching anything.
Format as approximate diffs — the new lines clearly attributed to their destination. Keep each
entry concise: one bullet or one short sentence per finding.

Ask the user to confirm, edit, or drop items. Only proceed once they approve.

## Step 6 — Append confirmed items

Write each confirmed item to its target file. Append under the most relevant existing section
heading if one exists; otherwise add a new section at the end. Do not reformat existing content.
