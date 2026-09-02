# Cleanup sequence

Load this sequence only after the user selects candidate IDs from the latest
current-conversation `mac-storage-cleanup` report. A selection authorizes
planning, not execution. Reapply [`POLICY.md`](POLICY.md) before preparing the
plan.

## 1. Resolve and refresh the selection

Map every selected ID to one disjoint candidate from the latest report version.
Ask for clarification when an ID is unknown, belongs to another report, contains
multiple possible actions, or overlaps another selection.

Remeasure free space and each selected candidate's allocated size. This value
becomes the execution baseline; background changes in unrelated free space do
not invalidate the selection. Keep this refresh read-only. If a selected item no
longer exists, mark it skipped.

Resolve one mechanism under `POLICY.md` for every non-skipped selection. For a
native tool, use its read-only listing or dry-run when available and bind the
plan to every affected object ID or to the exact whole-store candidate. A global
cleanup is ineligible when its complete effect extends beyond the selected
candidate or cannot be bounded.

This step is complete when every non-skipped selected ID has one current size
and one exact supported action, skipped IDs have reasons, and each native action
has a bounded affected-object set.

## 2. Present the authorization artifact

Give the plan a report-bound ID such as `R1-P1`. Increment its plan number for
each revision. A new plan supersedes every pending plan for that report, and a
new report invalidates all of its plans.

For each action show:

- candidate ID, classification, risk, and current allocated size
- exact command and complete affected-object or path scope
- canonical path, filesystem identity, and type for direct path actions
- size and modification time for each personal file
- whether the action is permanent
- expected reclaim range
- data or state that will be lost
- what will regenerate or require downloading
- required application shutdown or elevated privilege

List skipped and excluded selections with reasons. State immediate reclaim and
potential reclaim separately, without counting overlaps; a move to Trash has
zero immediate reclaim. If an action requires `sudo`, make privilege escalation
explicit and keep credentials outside the conversation and command arguments.

Use this shape:

```text
Cleanup plan R1-P1
R1-C1 — <class and risk> — <current size> — <permanent or Trash>
  Scope: <object IDs, or canonical path, filesystem identity, and type>
  Personal-file metadata: <size and modification time, when applicable>
  Action: <exact supported command>
  Effect: <loss and regeneration>

Immediate reclaim: <range>
Potential reclaim after Trash is emptied: <range>
Skipped/excluded: <IDs and reasons>

Reply “Approve cleanup plan R1-P1” to run exactly this plan, or request changes.
```

Selection language by itself is not approval. Accept approval only for the
exact latest active plan ID. A changed command, path, object set, metadata,
risk, expected effect, or permanence creates a new plan ID, supersedes the old
plan, and requires fresh approval.

This step is complete only when a content-bound, report-bound plan is visible
and the assistant is waiting for explicit approval of its exact active ID.

## 3. Validate the approved scope

Immediately before execution, record current free space as the final baseline
and revalidate every action against `POLICY.md`. Refresh each native listing or
dry-run and require the affected object IDs to equal the approved set. For every
direct path action, verify that:

- its canonical path, filesystem identity, and type match the plan
- it is not a symbolic link, mount point, or cross-filesystem target
- it is the exact approved personal file or recognized generated root
- the command contains exact quoted paths, with no glob, broad `find -delete`,
  command substitution, or parent-directory target

For personal files, require the approved size and modification time. For a
generated root, apply the policy's size-change bound and verify that its owner is
stopped. Stop and present a new plan version if target membership, loss, risk,
permanence, expected reclaim, command, or mechanism differs from the approved
artifact. Missing or reduced targets can be skipped when that is the only
change.

This step is complete when every remaining approved action has the approved
identity, scope, mechanism, and effect.

## 4. Execute the approved plan

Run exactly the approved mechanism for each action. Run direct path actions one
candidate at a time so each result is observable. Stop on the first unexpected
expansion, prompt, or failure and preserve the remaining actions for a revised
plan.

Record each action's exit status and the target's allocated size afterward. Do
not add opportunistic cleanup discovered during execution.

This step is complete when every approved action is recorded as completed,
skipped, or failed and no unapproved target was included.

## 5. Verify and report

Remeasure APFS allocation and immediately available space. Compare them with the
pre-cleanup baseline and report:

- actual space reclaimed
- outcome for every approved candidate
- Trash space still awaiting emptying
- failures or application-managed follow-up
- the largest remaining report findings

Disk writes can occur concurrently, so distinguish measured free-space change
from the sum of removed candidates when they differ. State that no unapproved
cleanup was performed.

Mark the executed plan closed. The workflow is complete when every approved
candidate is accounted for, the post-cleanup capacity is visible, and no pending
plan remains actionable.
