---
name: draft-commits
description: Draft an approval-gated commit plan that matches the repository's history.
disable-model-invocation: true
---

# Draft Commits

Turn uncommitted work into an approval-gated commit plan, then apply that exact
plan only after the user approves it.

## 1. Inspect conventions and changes

Read the nearest `AGENTS.md` and inspect recent commit subjects:

```bash
git log -12 --pretty=format:"%s"
```

Infer prefixes, casing, tone, and title length from the repository. Inspect
branch names when proposing a new branch so the suggestion follows local
conventions rather than imposing a global prefix scheme.

Gather and inspect every staged, unstaged, and untracked change without staging
anything:

```bash
git status --porcelain
git diff
git diff --cached
git diff --stat
git branch --show-current
```

Read untracked files needed to understand their purpose and mark their inclusion
as requiring the user's decision. If there are no changes, stop and report that.

This step is complete when the repository's title and branch conventions are
known and every changed path has been inspected and classified as staged,
unstaged, or untracked.

## 2. Build the commit plan

Group changes by the reason they belong together. Keep coupled implementation,
tests, migrations, generated artifacts, and dependency lockfiles together when
one would be incomplete without the others. Separate genuinely independent
behaviour, maintenance, documentation, or formatting changes. Prefer a few
coherent commits over micro-commits.

For each planned commit, provide:

- one single-line title in the repository's inferred style
- one sentence explaining what changes and why
- every included path with Git status and staged state

Account for every changed path exactly once by placing it in a planned commit or
listing it as excluded or awaiting an inclusion decision.

Suggest the target branch with the plan. Use the current branch when it matches
the work. Otherwise propose a branch name in the repository's observed style;
when no convention is visible, describe the intended branch and ask the user to
choose its name.

This step is complete when the branch is explicit and every changed path is
accounted for exactly once.

## 3. Present the approval artifact

Present the complete plan in a reviewable form:

```text
Suggested branch: use current branch <name>
# or: create <proposed-name>

Commit 1 — <title>
  <what changes and why>
  M  path/to/file — staged
  A  path/to/other — untracked, include if approved

Excluded:
  path/to/file — <reason>
```

Ask the user to review the branch, grouping, titles, inclusions, and exclusions.
An unambiguous confirmation made in direct response to this complete plan is
approval to apply it.

## 4. Revise until approved

Apply requested regrouping, renaming, inclusion, exclusion, splitting, or
merging to the plan. Present the complete revised plan again; each revision
replaces the previous approval artifact and requires fresh approval.

Questions that leave the plan unchanged do not create a new revision. This step
is complete only when the user approves the current complete plan.

## 5. Apply the approved plan

Re-check the current branch and working tree before changing either. If the
branch or changed paths differ from the approved plan, stop and present an
updated plan for approval.

Create the approved branch when required, then stage only the exact paths in
each approved commit and commit them in order:

```bash
git add <exact approved paths>
git commit -m "<single-line approved title>"
```

Use one `-m` value and no commit body. If staging, a hook, or a commit fails,
stop and report the resulting repository state so the user can choose the next
action.

After each successful commit, report its hash and title. Finish by showing the
new commits and all remaining changes:

```bash
git log -<number-of-created-commits> --oneline
git status --short
```

The workflow is complete when every approved commit exists on the approved
branch and every remaining change is visible in the final status.
