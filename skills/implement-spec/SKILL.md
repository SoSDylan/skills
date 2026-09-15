---
name: implement-spec
description: "Implement a specification as one PR with parallel ticket agents and automatically commit workflow-owned changes."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The goal is a PR which implements the entire spec on a single branch.

Direct invocation of this skill pre-authorizes commit plans for exact changes
produced by this workflow, including work delegated to its subagents. Existing,
unrelated, or ambiguous changes remain approval-gated.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for **maximum concurrency**.

## Commit protocol

Every subagent that creates a commit must follow `/draft-commits`. Include this
protocol in its handoff prompt:

1. Before changing files, capture `git status --porcelain` and the current branch
   as the working-tree baseline.
2. Track a run-owned content manifest that binds each attributable path to its
   final Git status and content hash.
3. After implementation and verification, invoke `/draft-commits` in
   pre-authorized mode. Supply the baseline and manifest, and identify the user's
   direct invocation of `implement-spec` as the authorization source.
4. Present the complete commit plan, then apply it without waiting for a second
   confirmation.

Pre-authorization covers only bound content in paths that were clean at the
baseline. A plan containing a baseline path, unrelated or ambiguous content, or
an unresolved branch choice uses approval-gated mode. A subagent's commit work is
complete when every in-scope change exists in an authorized commit and all
remaining worktree changes are reported.

## Bounded implementation pass

The task graph controls scheduling; each assigned ticket controls implementation
scope. Every implementation or correction subagent must use this pass for its
assigned scope:

1. **Establish the source of truth.** Read the assigned ticket, relevant spec
   sections, and repository instructions. Create a short internal checklist of
   required behaviour, acceptance criteria, explicit exclusions, constraints,
   dependencies, and assumptions. Ask only when ambiguity could materially
   change public behaviour, the data model, an external contract, or scope.
   Otherwise, use the least-expansive interpretation and record the assumption.
2. **Explore relevant code.** Locate the existing implementation patterns,
   focused tests, and verification commands needed for the checklist. Keep
   exploration within the assigned scope.
3. **Implement.** Make the smallest coherent change that satisfies the
   checklist. Work in vertical slices, follow repository conventions, and add or
   update focused tests in the repository's existing style. Run the affected
   test or typecheck after each meaningful slice.
4. **Verify and stabilize once.** Run focused tests, applicable typecheck, lint,
   or build checks, and the full suite once when practical. Fix failures caused
   by the change in one correction pass, then rerun affected checks. Put
   pre-existing failures, later-ticket work, and optional improvements in the
   completion report and leave them unchanged.
5. **Report.** Report what changed, verification and results, assumptions,
   remaining limitations, and authorized commit hashes.

The pass is complete when every checklist item is implemented, applicable checks
have run, and remaining limitations are reported. Completion ends the assigned
scope.

Every implementation and correction handoff must direct the subagent to read
`$HOME/.agents/skills/implement-spec/SKILL.md` and follow **Bounded
implementation pass** for its assigned scope. This file is the context pointer;
do not copy the protocol into handoffs.

## Steps

1. Read the spec and tickets. Read enough to understand the task graph.

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets - relevant codebase files or external documentation. Ensure the exploration subagent can save files - it should save its markdown notes in a directory outside the repo, accessible by all future subagents. This lets **implementer subagents** focus on implementation rather than exploration.

3. Create a branch, and a draft PR. The PR should be marked as 'closing' the spec issue and tickets.

4. Use **implementer subagents** to implement each ticket. Each implementer
subagent should work in its own worktree, on its own branch. Its handoff must
point to the bounded implementation pass, include the commit protocol, define
its exact ticket scope, and require the resulting authorized commit hashes.

5. Once an **implementer subagent** completes, merge its work to the PR branch
with a **merger subagent**. The merger must follow the commit protocol for each
integration commit and report the resulting PR-branch hashes.

6. If this changes the **frontier** of available tickets, kick off more **implementer subagents** to work on the new tickets. This allows for maximum concurrency.

7. Once all tickets are complete, run the applicable integrated checks once,
then run /code-review on the PR branch. Triage its findings before changing code.
In one **implementer subagent**, fix findings caused by this implementation that
violate the spec, repository standards, or correctness. Report pre-existing
issues, later-ticket work, and optional improvements without implementing them.
Its handoff must point to the bounded implementation pass and include the commit
protocol. Rerun checks affected by its corrections. End stabilization after this
single correction pass; report remaining findings without another review.

8. Mark the PR as ready for review.

9. Clean up all **implementer subagent** worktrees.
