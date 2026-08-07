---
name: implement
description: "Implement a piece of work from a spec or set of tickets."
disable-model-invocation: true
---

# Implement

Complete the requested work in one linear pass. The primary agent owns the
implementation. One read-only scout subagent is optional when a focused
exploration question would materially reduce uncertainty.

## 1. Establish the source of truth

Read the supplied spec or tickets and the repository instructions. Create a
short internal checklist containing:

- required behaviour and acceptance criteria
- explicit scope exclusions
- constraints and dependencies
- assumptions needed to proceed

Ask the user only when an ambiguity could materially change public behaviour,
the data model, an external contract, or scope. Otherwise, use the
least-expansive interpretation and record the assumption.

This step is complete when each acceptance criterion is actionable and no known
blocker remains.

## 2. Explore the relevant code

Locate the existing implementation patterns, tests, and verification commands.
Keep exploration limited to the parts of the repository relevant to the
checklist.

This step is complete when the files to change, patterns to follow, and checks
to run are known.

## 3. Implement

Implement the smallest coherent change that satisfies the checklist. Work in
vertical slices and follow existing repository conventions.

Use `/tdd` only when the user requested TDD or the testing seams were already
agreed. Otherwise, add or update focused tests using the repository's existing
test style. Run the affected test or typecheck after each meaningful slice.

This step is complete when every checklist item is implemented and there is no
known incomplete work.

## 4. Verify and stabilize

Run the applicable checks:

1. focused tests for changed behaviour
2. typecheck, lint, or build checks used by the repository
3. the full test suite once, when practical

Fix failures caused by the change and rerun the affected checks. Report verified
pre-existing or unrelated failures without expanding scope.

Then invoke `/code-review` once for the current working tree. Ask it to review
tracked changes with `git diff HEAD` and include every path from
`git ls-files --others --exclude-standard`, because untracked files do not
appear in the diff. Supply the original spec or tickets as the Spec source.

Triage the review findings before changing code:

- fix findings caused by this implementation that violate the spec, repository
  standards, or correctness
- report pre-existing issues, later-ticket work, and optional improvements
  without implementing them

Batch the accepted findings into one correction pass, then rerun the checks
those corrections affect. The workflow ends after this stabilization pass.
Report remaining findings rather than invoking another review.

## 5. Report

Report concisely:

- what changed
- verification performed and its result
- assumptions made
- known failures or remaining limitations

Leave changes uncommitted unless the user requested a commit. When requested,
use `/draft-commits` and wait for approval.
