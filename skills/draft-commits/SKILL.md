---
name: draft-commits
description: Draft commits, grouped and titled to match the repo's own commit style.
disable-model-invocation: true
---

# Draft Commits

Turn a pile of uncommitted changes into one or more clean commits that match the repo's existing commit conventions, confirmed with the user before anything is committed.

## Hard rules

- **Never commit without explicit user confirmation.** Only commit when the user says "looks good", "commit it", "go ahead", or similar. "Yes" to a question is not enough unless it's confirming the final commit.
- **Single-line commit messages only.** Never use a multi-line message or a body. Just the title.
- **Reuse the repo's own commit style.** Infer it from the last 12 commits — do not impose `feat:`/`fix:` if the repo doesn't use prefixes.
- **Group related files into separate commits** with one title each. Don't dump everything into one commit unless the changes are genuinely one logical unit.
- **Suggest the target branch with the commit plan.** The user should review branch + commit structure together before approving.

## Workflow

### 1. Learn the repo's commit style

Run:

```
git log -12 --pretty=format:"%s"
```

Read the last 12 commit subjects and identify:

- Whether prefixes are used (`feat:`, `fix:`, `chore:`, scope like `api:`, etc.) or not.
- Casing of the first word after any prefix.
- Tone and length (imperative? terse?).
- Any project-level convention (check nearest `AGENTS.md` — e.g. this project uses `feat:`/`fix:`/`chore:` with a Capitalized first letter).

Adopt that exact style for all drafted titles. Do not invent a new convention.

### 2. Gather all uncommitted changes

Collect staged + unstaged tracked changes (do not auto-stage). Use:

```
git status --porcelain
git diff          # unstaged
git diff --cached # staged
git diff --stat   # for a quick overview
```

Untracked files: list them and ask the user whether to include them (don't assume). Use `git diff --no-index /dev/null <file>` or just read the file to understand content if needed.

If there are zero changes, stop and tell the user.

### 3. Split changes into focused commits

Inspect the actual diffs (not just filenames) and split by concern. The granularity below matches this repo's established conventions (verified against the last 50 commits). When in doubt, prefer fewer commits over micro-commits.

**Backend** — keep these together as a unit:

- **Model + migration** in one commit (e.g. a new field lands with its Alembic migration). Do not split the migration from the model change that motivated it.
- **Serializer + viewset + tests** in one commit when they change for the same reason (an endpoint change touches all three). If the serializer or viewset change is tiny and standalone, it can join the model commit; if it's substantial (new endpoint, real behavior), it's its own commit.
- **Permissions** as a separate commit when substantial (new permission model/constant), or bundled with the model commit when trivial.
- **Calculation helpers / business logic** as a separate commit when it's a distinct behavior change.

**Frontend** — always separate data layer from UI:

- **Data layer** = `apis/`, `dtos/`, `models/`, `utils/`, `types/`. Group these into one commit when they change together for a feature.
- **UI layer** = `views/`, `components/`. Group these into one commit when they change together.
- Only split within a layer when changes are large or genuinely independent (e.g. two unrelated UI changes). Small changes within a layer stay merged.

**Cross-cutting / unrelated** — always its own commit, never bundled into a feature:

- Docs (`AGENTS.md`, `CONTEXT.md`, `docs/`, `CLAUDE.md`)
- Config (`.claude/`, `package.json`, lint rules)
- Formatting/style/import-ordering churn
- Lockfile changes (unless tied to a real dependency add in a feature commit)

**Merging rule**: if a commit would only touch one or two files with a handful of lines and they change for the same reason as an adjacent commit, merge them. Split when the diff is large or the concern is distinct.

For each commit:

- List the exact files (paths as git sees them) with status.
- Assign one single-line title in the repo's inferred style.
- Write a one-line "what changed" summary in plain language (see presentation).
- Note whether files are currently staged or unstaged.

### 4. Present the draft to the user

Show a clear, reviewable plan where **the branch and each commit explain themselves**. Do not just dump a file list; the user must be able to understand the target branch and each change without opening the diffs.

Before presenting the plan, suggest the branch that should receive the commits:

1. Check the current branch:

   ```bash
   git branch --show-current
   ```

2. If the current branch seems related to the planned commits, suggest using it.
3. Otherwise, suggest creating a new branch.

For new branches, infer the prefix from the planned commit contents:

- `feature/` — new functionality, additions, enhancements
- `fix/` — bug repairs, regressions, broken behaviour
- `chore/` — docs, config, refactors, maintenance, or other non-user-facing work

If ambiguous, ask the user to choose the branch prefix as part of the review.

Derive the branch name from the primary commit title or overall change summary:

1. Slugify: lowercase, replace spaces/special chars with `-`, collapse runs of `-`, trim leading/trailing `-`
2. Cap at 50 chars (trim at a word boundary if possible)
3. Prepend the prefix: `feature/<slug>`, `fix/<slug>`, or `chore/<slug>`

Format:

```
Suggested branch: create feature/<slug>
  Based on the main change: <brief reason>

Commit 1 — <title in repo style>
  <one line: what this commit changes and why>
  M  src/foo.ts
  M  src/foo.test.ts

Commit 2 — <title in repo style>
  <one line: what this commit changes and why>
  A  src/bar.ts

Untracked (ask): config/local.json
```

If suggesting the current branch, format the first line as:

```
Suggested branch: use current branch <branch-name>
```

Then ask the user to review the branch and commit plan and request changes.

### 5. Apply requested changes and re-confirm

If the user asks for edits (regrouping, renaming a title, dropping files, splitting/merging commits):

- Update the plan.
- Re-present the full updated plan.
- Ask again to confirm.

**Always re-confirm after any change.** Loop until the user explicitly approves.

If the user only asks a question or clarifies something without changing the plan, you do not need to re-confirm — but never commit until you have an explicit "looks good / commit it" on the current plan.

### 6. Create or confirm the approved branch (only after plan approval)

Before creating commits, ensure they land on the branch approved in the plan.

Check the current branch:

```bash
git branch --show-current
```

If the approved plan says to use the current branch and it is still the same branch, continue.

If the approved plan says to create a new branch, create exactly the approved branch:

```bash
git checkout -b <approved-branch>
```

If the current branch has changed since the plan was approved, or if the approved branch already exists, stop and ask the user how to proceed.

Briefly confirm the actual branch to the user before committing.

### 7. Commit (only after explicit approval)

Execute the commits in order. For each commit:

```
git add <exact files for this commit>
git commit -m "<single-line title>"
```

Rules:

- Use `-m` with one string only. Never `-m "title" -m "body"`, never embedded newlines.
- Add only the files listed for that commit — not `git add -A` unless that was the agreed plan for a "commit everything" commit.
- After each commit, briefly report what was committed (hash + title).

If any `git add` or `git commit` fails (e.g. pre-commit hook), stop, report the error, and ask the user how to proceed. Do not silently retry or force.

### 8. Final report

After all commits land, show:

```
git log -<n> --oneline
git status --short
```

so the user can see the new commits and any remaining changes.

## Quick checklist

- [ ] Read last 12 commit subjects to learn the repo's style
- [ ] Gather staged + unstaged + untracked changes
- [ ] Inspect real diffs, not just filenames
- [ ] Split by concern using repo conventions (backend model+migration, serializer+viewset+tests; frontend data layer vs UI)
- [ ] Each commit has a one-line plain-language summary, not just a file list
- [ ] Suggest target branch with the commit plan
- [ ] Present branch + commit plan; ask for review
- [ ] On any change: update plan and re-confirm
- [ ] Commit only on explicit "looks good / commit it"
- [ ] Before committing, create or confirm the approved branch
- [ ] One `-m` string per commit, no body, no newlines
- [ ] Report hashes + final `git log` / `git status`
