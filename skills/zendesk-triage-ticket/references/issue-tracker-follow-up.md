# Issue-Tracker Product Follow-Up

Use this branch when Zendesk triage determines that product follow-up is required
or uncertain. Prepare the issue automatically; mutate the tracker only after
explicit approval.

## 1. Resolve tracker routing

Read the nearest repository instructions and every issue-tracker or triage-label
document they point to. Use their tracker, destination, authentication path,
Project rules, workflow, and labels as authoritative. Use the installed tracker
skill for supported operations. Resolve identifiers through the tracker rather
than guessing them.

If the repository does not identify a unique tracker or destination, ask the
operator to choose before searching or publishing. Continue to draft the issue
while routing is unresolved.

This step is complete when the tracker and destination are resolved or the exact
routing decision needed from the operator is named.

## 2. Search for duplicates

Search the resolved destination by:

- Zendesk ticket ID and URL
- customer-visible symptom
- proposed title and distinctive problem wording
- relevant error, report, operation, or product entity

Inspect every likely match. When one may represent the same product problem,
show its identifier, title, status, and material overlap. Wait for the operator
to choose whether to use it or continue with a new issue. Keep existing issues
unchanged. An update to an existing issue is a separate tracker request with its
own preview, approval, and verification.

This step is complete when every search form was tried and each likely match was
inspected, or no match was found.

## 3. Draft the issue

Use this title:

```text
[Zendesk #<id>] <concise customer-visible problem>
```

Use only relevant sections:

```markdown
## Source
- Zendesk: <URL>

## Customer problem
<customer job, obstacle, and impact>

## Expected behavior
<supported product contract or desired outcome>

## Actual behavior
<observed customer-visible behavior>

## Reproduction
<smallest supported reproduction, or missing evidence>

## Evidence
<concise facts and references>

## Cause
<Established | Likely | Unresolved — current understanding>

## Supported approach
<supported product outcome or "Needs product/engineering investigation">

## Acceptance criteria
- <checkable customer-visible result>

## Workaround
<verified workaround or "None established">

## Missing evidence
- <material gap and evidence needed>

## Open questions
- <decision that remains>
```

Keep claims traceable to the triage evidence. Write checkable acceptance criteria
without inventing requirements. Exclude the full customer conversation,
credentials, unnecessary personal data, and unsupported implementation detail.

This step is complete when the issue explains why the work matters, gives the
smallest supported problem specification, and marks every material gap.

## 4. Select triage readiness

When repository instructions define canonical triage roles, select exactly one:

- `needs-info` — missing external evidence blocks problem framing or reproduction
- `ready-for-agent` — the work is bounded and testable with no blocking evidence
  or product decision
- `ready-for-human` — the problem is sufficiently specified but requires human
  judgment or access
- `needs-triage` — ownership, priority, product behavior, or approach still needs
  a maintainer decision

Map the role through repository instructions. Do not invent or apply a label
when the repository has no matching convention.

This step is complete when one role is justified and mapped, or the preview
states that no triage label will be set.

## 5. Preview and approve the mutation

Show the exact proposed mutation:

- tracker and destination
- full title and description
- triage label
- Project, assignee, state, priority, and other fields being set or left at
  documented defaults

Ask for explicit approval of the complete preview and wait. A requested change
produces a new complete preview and approval round.

This step is complete only when the operator explicitly approves the current
preview.

## 6. Create and verify

Create exactly the approved issue through the installed tracker skill and the
repository's documented authentication path. Inspect each result and perform the
required fresh read. Verify the destination, title, full description, and every
approved field.

After an ambiguous failure, search for the Zendesk ID before retrying so the
issue is not created twice. Report partial success and every verification
mismatch explicitly.

This branch is complete when the approved issue exists exactly once, its fields
match the preview, and its canonical identifier and URL are reported.
