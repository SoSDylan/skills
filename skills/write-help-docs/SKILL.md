---
name: write-help-docs
description: Generate code-verified help articles for a supplied collection directory.
disable-model-invocation: true
---

# Write help documentation

Invoke this skill from the application repository root and supply the help collection directory:

```text
/skill:write-help-docs ../intercom/schedule/
```

Treat the supplied directory as `<help-dir>`. Resolve a relative path from the current working directory. Ask for the path only when the user did not supply one. If the directory or `<help-dir>/README.md` does not exist, report the invalid path and stop.

## Sources and scope

- `<help-dir>/README.md` defines the complete article set, suggested investigation areas, and documented routes. Suggested sections are not mandatory headings; include only relevant, verified content.
- Generate only the listed articles. Write one Markdown file per article in `<help-dir>`.
- Normalize a title or filename stem by lowercasing its alphanumeric words and joining them with hyphens. Preserve an existing filename only when its normalized stem equals the normalized article title. Block target mapping if multiple files match. Otherwise, use the normalized article title as the filename.
- Use pre-existing Markdown articles in `<help-dir>` to derive their shared structure and layout. The applicable product reference overrides conflicting editorial patterns. Do not transfer product claims between articles.
- When the user identifies existing content as approved, preserve its active-code-supported substantive meaning and article-specific details. Revise its wording and organization to meet the writing rules. If active code contradicts a substantive approved claim, treat the conflict as a material ambiguity. Approval does not make the article product evidence for another topic.
- If `<help-dir>` has no pre-existing article, use this default layout: H1 title, short introduction, **Before you start** when prerequisites exist, task sections, **What happens next** only for necessary consequences, and **Troubleshooting** when verified recovery content exists.
- Use the current codebase as the source of truth for all product behavior.
- Treat browser observations as supporting evidence, not as a replacement for code evidence.
- **CrewTraka:** Read and apply [`references/crewtraka-help-style.md`](references/crewtraka-help-style.md) to every article. It is authoritative for CrewTraka editorial style and support directions.
- **Other products:** Follow the explicit product support policy. Omit support directions when no policy exists.

## 1. Fix the target set

Read `<help-dir>/README.md`, list `<help-dir>`, and read the applicable product reference. Inspect existing mapped outputs for shared structure and layout. Record a concise summary of the structure, layout, product rules, and any user-approved content supplied for the run. Map every listed article to exactly one output file. Create a temporary backup of each existing output file and record its SHA-256 hash. Record which outputs did not exist.

This step is complete when every listed article has one output path, no unlisted article is in scope, and every applicable reference and approved-content baseline is recorded.

## 2. Assign article owners

Dispatch one write-capable subagent for each article. An owner handles exactly one article and can edit only its output file. Dispatch independent owners in parallel and use batches when the tool has a concurrency limit.

Each handoff must include:

- application repository root and applicable repository instructions;
- `<help-dir>`, documented collection routes, and its `README.md` article entry;
- article title, suggested investigation areas, and output path;
- the pre-run structure, layout, product-rule, and approved-content summary, with each source's boundary;
- the code-evidence requirements;
- all article rules and the ASD-STE100 checklist at [`references/asd-ste100-checklist.md`](references/asd-ste100-checklist.md);
- the applicable product reference and support policy;
- the ambiguity gate; and
- the required owner report.

A subagent has no parent conversation. Make each handoff self-contained.

This step is complete when every mapped article has exactly one owner, each owner is restricted to one output file, and every handoff contains all required sources, rules, evidence requirements, gates, and report requirements.

## 3. Build the evidence map before drafting

Require each owner to identify the active implementation before it uses code as evidence. Trace routes and imports to distinguish current code from legacy, deprecated, or unreachable code.

The evidence map must cover each applicable item:

- entry point and prerequisites;
- roles and permissions;
- visible states and workflow branches;
- user actions and exact interface labels;
- validation and formatting rules;
- fields or actions that change conditionally;
- persistence, side effects, and partial failures;
- final user action and the code path that handles it;
- required completion indicators; and
- code-reachable failures, user problems, and supported recovery actions.

Inspect frontend and backend code when backend behavior affects the workflow. Follow components through models, APIs, DTOs, serializers, permissions, and endpoints as necessary. Comments, existing help articles, tests without matching implementation, and assumptions are not sufficient product evidence.

This step is complete when every substantive product claim planned for the article has concise `path:line` evidence. A user clarification can narrow scope or identify the correct code path, but it does not replace code evidence for product behavior.

## 4. Apply the ambiguity gate

An owner must complete its evidence map before it drafts. If code leaves a material ambiguity, the owner must leave the output file unchanged and report:

- the exact unresolved question;
- why the answer changes the article;
- the relevant code paths and findings; and
- the missing fact that code does not establish.

An ambiguity is material when it changes scope, prerequisites, permissions, user actions, validation, persistence, side effects, the final action, or failure recovery.

Consolidate and deduplicate all owner questions. Group them by article and return the complete list before drafting the affected articles. Continue work on unaffected articles. After the user replies, verify the answer against active code before you resume the article. Keep the article blocked when code still does not establish the behavior.

This step is complete when every blocked file is unchanged and all blocking questions are in one consolidated list.

## Article rules

- Follow the source precedence in **Sources and scope**. Preserve approved substantive meaning only within its own article. Do not transfer product claims between topics.
- Read and apply every rule in [`references/asd-ste100-checklist.md`](references/asd-ste100-checklist.md) and the applicable product reference.
- Include a detail only when it helps the reader prepare, choose, complete, verify, understand a necessary consequence, or recover from the task.
- Group routine fields, choices, and visible values at the user-task level. Name an item only when it needs an explanation, has validation or formatting requirements, changes available fields or actions, affects a later step, or is necessary to understand or recover from the workflow.
- Include troubleshooting for code-reachable failure cases and user problems that follow from verified states or validation. Give only recovery actions that the code supports. Describe a problem as common only when support or analytics evidence establishes frequency.
- Keep implementation details and code citations out of the customer article unless the reader needs the detail to complete the task.

After drafting, the owner must run separate ASD-STE100, product-style, and task-level edit passes on its article.

## Owner report

Require each owner to return:

- output path and status: `written` or `blocked`;
- concise `path:line` evidence for every substantive product claim and documented workflow branch;
- unresolved questions, if any; and
- confirmation that it applied the article rules, ASD-STE100 checklist, product reference, and support policy.

Keep the evidence in the report, not in the customer article.

## 5. Review, update, and verify once

Use one bounded review-update-verification cycle per written article:

1. Dispatch one read-only verifier. The verifier audits exactly one article against the active code, owner evidence, ASD-STE100 checklist, and applicable product reference. It must flag every unsupported behavior, incorrect label, missing workflow branch, invalid recovery action, and rule violation with article and source lines.
2. Triage the first-verification findings once. Send accepted findings to one write-capable correction subagent that handles only the affected article. The correction subagent must address all accepted findings, keep article scope fixed, and run factual, ASD-STE100, product-style, and task-level self-audits on the complete article. An article with no accepted findings receives no correction pass.
3. Dispatch one final read-only verifier for every written article after the correction phase. The final verifier audits the complete article against the same sources and returns `PASS`, `FAIL`, or `AMBIGUITY` with article and source lines.

Each article receives two verification passes and no more than one correction pass. Do not start another correction pass after final verification. Record every final-verification finding for the user.

If either verifier or the correction subagent exposes a material ambiguity, restore an existing output from its temporary backup or remove a new output. Confirm the restored file hash when applicable. Add the question to the consolidated list and wait for the user before you resume that article in a later run.

This step is complete when each written article has two verification passes, no more than one correction pass, and a recorded final-verification result.

## 6. Run the collection audit

Confirm that:

- every README article has exactly one Markdown file;
- no unlisted article was generated;
- approved content was preserved or a code conflict was blocked;
- every documented behavior has active-code evidence;
- every detail passes the relevance gate;
- every named field, choice, or visible value meets at least one item-mention criterion;
- troubleshooting contains only verified cases and recovery actions;
- every written article received an initial and final verification;
- every article with accepted initial findings received no more than one correction pass;
- every accepted initial finding was applied or reported;
- every final-verification finding is recorded for the user;
- every blocked existing file retains its pre-run hash;
- every blocked new output remains absent; and
- all unresolved questions are reported.

Run every scan required by the applicable product reference and support policy. Read every final article in full after the scans. The collection audit must not start another article review or correction pass. Report newly found issues as residual findings.

Report the output files, audit result, accepted corrections, complete final-verification findings, residual findings, and consolidated unresolved questions. Remove the temporary backup only when the collection is not blocked. If the collection is blocked, keep any backup and report its path. The run is complete when the bounded review-update-verification cycle and collection checks finish. Report the collection as blocked only for a material ambiguity, a missing output, a failed restoration, or an accepted finding that the correction subagent could not resolve safely.
