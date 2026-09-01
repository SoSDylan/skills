---
name: draft-commits
description: Draft and apply a repository-matched commit plan before creating Git commits. Always use before creating a Git commit. Require user approval unless a directly invoked workflow explicitly pre-authorizes commits for its own changes.
---

# Draft Commits

Turn uncommitted work into a complete commit plan, authorize it under the
applicable mode, then apply that exact plan.

## Authorization modes

Use **approval-gated mode** by default.

Use **pre-authorized mode** only when all of these conditions are true:

- the user directly invoked the calling workflow
- that workflow's documented contract states that invocation authorizes commits
  for its own changes without a second confirmation
- the workflow supplies the working-tree baseline captured before it made changes
  and a manifest binding each run-owned path to its exact final status and content

Pre-authorization covers only the bound content in manifest paths that were clean
at the baseline. Route baseline changes, unrelated changes, ambiguous untracked
files, and unresolved branch choices through approval-gated mode. Record the
mode and its authorization source in the plan.

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

Read untracked files needed to understand their purpose. In approval-gated mode,
mark their inclusion as requiring the user's decision. In pre-authorized mode,
include them only when they were absent from the supplied baseline and were
produced by the calling workflow; otherwise mark them as awaiting a decision. If
there are no changes, stop and report that.

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

## 3. Present the authorization artifact

Present the complete plan in a reviewable form:

```text
Authorization: approval required
# or: pre-authorized by direct invocation of <workflow>
Suggested branch: use current branch <name>
# or: create <proposed-name>

Commit 1 — <title>
  <what changes and why>
  M  path/to/file — staged
  A  path/to/other — untracked, include if authorized

Excluded:
  path/to/file — <reason>
```

In approval-gated mode, ask the user to review the branch, grouping, titles,
inclusions, and exclusions. An unambiguous confirmation made in direct response
to this complete plan authorizes it.

Bind the artifact to the exact status and content inspected for every included
path. In pre-authorized mode, verify that this content is within the authorized
scope and that the plan contains no unresolved decision. Present the artifact
and continue without pausing for a second confirmation. If either condition
fails, use approval-gated mode for the complete plan.

This step is complete when the content-bound artifact is presented and either
awaits explicit approval or satisfies every pre-authorization condition.

## 4. Resolve plan authorization

In approval-gated mode, apply requested regrouping, renaming, inclusion,
exclusion, splitting, or merging. Present the complete revised plan again; each
revision replaces the previous artifact and requires fresh approval. Questions
that leave the plan unchanged do not create a revision.

In pre-authorized mode, regrouping, title, or branch revisions remain authorized
only when the exact included status and content stay unchanged and no unresolved
user decision remains. Route every content or status revision through
approval-gated mode.

This step is complete when the current complete plan is either explicitly
approved or validly pre-authorized.

## 5. Apply the authorized plan

Re-check the current branch, path statuses, and exact content before changing
either the branch or index. If any value differs from the authorized artifact,
present the updated complete plan in approval-gated mode.

Create the authorized branch when required. Apply each commit from an isolated
temporary index so existing staged changes cannot enter it:

1. Record the current `HEAD` as the parent. Create a temporary index, initialize
   it from that parent, and stage the commit's exact paths into it.
2. Inspect the temporary index's complete `--name-status` and `--binary` cached
   diff. Continue only when both match the artifact exactly.
3. Commit with the temporary index by setting `GIT_INDEX_FILE` for `git commit`.
   Use one `-m` value and no commit body.
4. Record the created hash and verify its complete paths and content against the
   artifact before changing the real index.
5. On success, run `git reset -q HEAD -- <exact authorized paths>` without
   `GIT_INDEX_FILE`, then remove the temporary index. This refreshes only the
   committed paths while preserving unrelated staged changes.

If a hook changes the commit or post-commit verification cannot complete,
atomically restore the branch with
`git update-ref HEAD <parent-hash> <created-hash>`, remove the temporary index,
and stop. If staging, a hook, or a commit fails, remove the temporary index and
report the resulting repository state so the user can choose the next action.

After each verified commit, report its hash and title. Finish by showing the new
commits and all remaining changes:

```bash
git log -<number-of-created-commits> --oneline
git status --short
```

The workflow is complete when every authorized commit exists on the authorized
branch and every remaining change is visible in the final status.
