---
name: implement-spec
description: "Implement a specification as one PR with sequential ticket agents and automatically commit workflow-owned changes."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The goal is a PR which implements the entire spec on a single branch.

Direct invocation of this skill pre-authorizes commit plans for exact changes
produced by this workflow, including work delegated to its subagents. Existing,
unrelated, or ambiguous changes remain approval-gated.

The tickets form a **task graph** with blocking relationships. The **frontier**
contains unfinished tickets whose dependencies are complete. Select one ticket
at a time from this frontier.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

## Execution model

Use one PR branch and one shared worktree for the entire workflow. Each ticket
gets a fresh **implementer subagent**, run sequentially. Implementers and the
final correction subagent work directly on that branch in the same worktree,
appending ordinary commits to a linear history.

The active implementer is the sole repository writer, including file edits,
index changes, and commits. The parent waits for it to finish before dispatching
the next implementer or changing repository state.

Exploration and review subagents may run in parallel with each other, with
read-only access to the repository. Save shared research notes outside the
repository. Pause implementation during review so reviewers inspect a stable,
committed snapshot.

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

1. Read the spec and tickets. Identify dependencies and the initial frontier.

2. Optionally use **exploration subagents** to inspect relevant code or external
   documentation under the execution model above. Make their research notes
   accessible to subsequent implementers through context pointers.

3. Create the PR branch in the current worktree and a draft PR. Record the branch
   name and absolute worktree path for all implementation handoffs. The PR should
   be marked as 'closing' the spec issue and tickets.

4. If unfinished tickets remain but the frontier is empty, report the dependency
   blocker and stop. Otherwise, select one ticket from the frontier and dispatch
   a fresh **implementer subagent**. Its handoff must specify the PR branch and
   shared worktree, define its exact ticket scope, point to the bounded
   implementation pass, include the commit protocol, and require authorized
   commit hashes and a report of remaining worktree changes. Direct it to use
   the existing branch and worktree throughout its work.

5. Wait for the implementer to finish. Before marking the ticket complete or
   starting another, confirm that its checklist is satisfied, applicable checks
   pass apart from documented pre-existing failures, its authorized commits are
   on the PR branch, and none of its in-scope changes remain uncommitted.
   Preserve unrelated baseline changes. If any completion condition is unmet,
   pause and report the blocker rather than dispatching another writer.
   Otherwise, mark the ticket complete and refresh the frontier. Repeat from
   step 4 until all tickets are complete.

6. Once all tickets are complete, run the applicable integrated checks once,
   then run /code-review on the PR branch. Triage its findings before changing
   code. In one **implementer subagent**, fix findings caused by this
   implementation that violate the spec, repository standards, or correctness.
   Report pre-existing issues, later-ticket work, and optional improvements
   without implementing them. Use the same handoff requirements and completion
   gate as steps 4–5, with the accepted findings as its scope, on the same PR
   branch and shared worktree. Rerun checks affected by its corrections. End
   stabilization after this single correction pass; report remaining findings
   without another review.

7. Mark the PR as ready for review only when all required behaviour is
   implemented and no workflow-caused check failures or blocking review findings
   remain. Otherwise, leave it in draft and report the blockers.
