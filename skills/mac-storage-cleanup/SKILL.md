---
name: mac-storage-cleanup
description: Audit macOS storage, choose cleanup candidates, and run an approved cleanup plan.
disable-model-invocation: true
---

# Mac Storage Cleanup

Use an **inventory → report → select** sequence. The inventory and report are
read-only. A selection opens the separate cleanup sequence; it does not authorize
deletions. Apply [`POLICY.md`](POLICY.md) as the single source of truth for
accounting, candidate eligibility, and cleanup mechanisms.

## Entry routing

Resume the latest active artifact in the current conversation:

- An initial audit or cleanup request starts at step 1.
- Candidate selection from the latest report continues at step 4.
- A cleanup-plan question or revision reads `CLEANUP.md` and resumes at its
  planning gate.
- Approval proceeds to validation only when it names the latest active,
  report-bound plan exactly.

If the referenced report or plan is absent, superseded, or from another
conversation, restart at step 1 and require new report IDs and selection. An
approval message never starts an inventory or authorizes a similarly named old
plan.

## 1. Establish the baseline

Verify that the target is macOS and default to the startup disk and current user
unless the user names another volume or account. Record:

- physical capacity, APFS allocation, and immediately available space
- Data, System, Preboot, Recovery, and VM volume usage
- Time Machine local snapshots and other APFS snapshots
- the current user's home path

Use metadata-only commands such as `sw_vers`, `df`, `diskutil info`,
`diskutil apfs list`, `diskutil apfs listsnapshots`, and
`tmutil listlocalsnapshots`. Keep every command through the report read-only.
Run without `sudo`; record protected locations as audit gaps.

This step is complete when capacity, allocated space, free space, snapshots, and
the target account are known or explicitly marked inaccessible.

## 2. Build a physical-usage inventory

Measure allocated blocks with `du` and `stat`; treat Finder, Spotlight, and
logical file sizes as supporting evidence only. Use `-x` while measuring a
volume so mounted runtimes and disk images are not counted twice. Start
shallow, then descend into each branch of at least 1 GiB until named children
explain at least 90% of its visible allocation or the remaining allocation is
recorded as a residual.

Account for these branches when present:

- the Data volume's top-level directories
- every home-directory child, including hidden children
- `~/Library`, especially Application Support, Caches, Containers, Developer,
  Group Containers, Logs, package stores, and cloud-storage placeholders
- `/Library`, `/Applications`, `~/Applications`, `/usr/local`, `/opt`, and
  `/private/var`
- Downloads, Trash, virtual machines, local models, package managers,
  toolchains, simulators, emulators, and project build/dependency directories
- sparse images such as Docker disks, comparing logical and allocated size
- deleted-but-open files with `lsof +L1`

For every eligible finding of at least 500 MiB, identify the owning application
or tool, classification, reproducibility, and supported cleanup mechanism under
`POLICY.md`. Keep candidate boundaries disjoint. Show parent category totals as
context, not as selectable candidates when their children are candidates.

Large iCloud or File Provider entries can be `dataless`. Verify their allocated
blocks before attributing local usage. Reconcile visible Data-volume allocation
against APFS usage and state the unexplained residual. List exact inaccessible
branches that can contribute to that residual; do not claim their individual
sizes are known. Mark shared clone or snapshot reclaim conservatively under the
policy.

This step is complete when named children or a stated residual account for every
visible top-level branch of at least 1 GiB, every eligible finding of at least
500 MiB has an allocated size and classification, and the APFS residual and
inaccessible paths are explicit.

## 3. Present the report

State that the audit made no changes. Report:

1. capacity, used space, free space, and urgency
2. non-overlapping top-level physical usage
3. the main explanation for why storage is full
4. selectable cleanup candidates in a table
5. findings that require an application or macOS cleanup mechanism
6. audit gaps, dataless cloud files, snapshots, and deleted-but-open files

Label the report with an in-conversation version such as `R1` and its audit
time. Increment the version for each replacement report. A replacement report
invalidates all candidate IDs and pending cleanup plans from earlier reports.
Assign selectable IDs within it, such as `R1-C1`. For each ID include:

- allocated size and realistic reclaim range
- exact path or owning application
- classification and risk (`low`, `medium`, or `high`)
- what will be lost and what can be regenerated or downloaded again
- intended cleanup mechanism: native tool, application UI, Trash, or exact-path
  deletion

Apply the mechanism boundaries in `POLICY.md`. Report immediate and potential
reclaim separately for Trash actions. Explain that allocated size is not always
independently reclaimable and that displayed category totals may overlap only
when explicitly marked. Give a conservative total for the disjoint selectable
candidates.

End with: “Choose candidate IDs to prepare a cleanup plan, or choose none.” Make
no cleanup tool calls after presenting the report.

This step is complete only when the user has a self-contained report and the
assistant is waiting for candidate IDs.

## 4. Continue only after selection

When the user selects IDs from the latest report in the current conversation,
read [`CLEANUP.md`](CLEANUP.md) and follow its authorization sequence. If the
selection names an older report, or the report is absent from the current
conversation, restart at step 1, complete a replacement report with new IDs,
invalidate the prior IDs, and wait for a fresh selection.

This transition is complete only when every selected ID belongs to the latest
current-conversation report; otherwise the workflow remains at the report gate.
