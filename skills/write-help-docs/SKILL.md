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

- `<help-dir>/README.md` defines the complete article set, suggested sections, and documented routes.
- Generate only the listed articles. Write one Markdown file per article in `<help-dir>`.
- Normalize a title or filename stem by lowercasing its alphanumeric words and joining them with hyphens. Preserve an existing filename only when its normalized stem equals the normalized article title. Block target mapping if multiple files match. Otherwise, use the normalized article title as the filename.
- Use pre-existing Markdown articles in `<help-dir>` only to derive their shared structure and layout. Treat their product claims as unverified.
- If `<help-dir>` has no pre-existing article, use this default layout: H1 title, short introduction, **Before you start** when prerequisites exist, task sections, **What happens next** only for necessary consequences, and **Troubleshooting**.
- Use the current codebase as the source of truth for all product behavior.
- Treat browser observations as supporting evidence, not as a replacement for code evidence.

For CrewTraka Intercom documentation, link every support direction only to [CrewTraka support](https://www.crewtraka.com/support). Exclude support email addresses and phone numbers. This rule overrides reference articles. For another product, follow its explicit support policy. Omit support directions when no policy exists.

## 1. Fix the target set

Read `<help-dir>/README.md`, list `<help-dir>`, and inspect the structure reference. Record a concise summary of the shared structure and layout. Map every listed article to exactly one output file. Create a temporary backup of each existing output file and record its SHA-256 hash. Record which outputs did not exist.

This step is complete when every listed article has one output path and no unlisted article is in scope.

## 2. Assign article owners

Dispatch one write-capable subagent for each article. An owner handles exactly one article and can edit only its output file. Dispatch independent owners in parallel and use batches when the tool has a concurrency limit.

Each handoff must include:

- application repository root;
- `<help-dir>` and its `README.md` article entry;
- article title, suggested sections, and output path;
- the pre-run structure and layout summary, with its structure-only boundary;
- the code-evidence requirements;
- all article rules and the ASD-STE100 checklist at [`references/asd-ste100-checklist.md`](references/asd-ste100-checklist.md);
- the applicable support policy;
- the ambiguity gate; and
- the required owner report.

A subagent has no parent conversation. Make each handoff self-contained.

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

- Follow the reference structure and layout. Do not copy its product claims.
- Read and apply every rule in [`references/asd-ste100-checklist.md`](references/asd-ste100-checklist.md).
- Use the exact interface labels from the active implementation.
- Use numbered steps for all procedures. Keep prerequisite bullets declarative.
- Write each step at the user-task level. Combine obvious form entry into one step.
- Mention an individual field only when it needs an explanation, has validation or formatting requirements, changes available fields or actions, affects a later step, or is necessary to understand the workflow.
- Include only necessary user actions. Do not turn automatic system work into a user step.
- End each procedure with the final action that the user must take.
- Put necessary outcomes outside the numbered procedure. Include a confirmation message only when it contains required information, requires another action, or is the only reliable completion indicator for a long-running process.
- Omit routine success messages and routine visual confirmations.
- Include troubleshooting for code-reachable failure cases and common user problems that follow from verified states or validation. Give only recovery actions that the code supports. Describe a problem as common only when support or analytics evidence establishes frequency.
- Keep implementation details and code citations out of the customer article unless the user needs the detail to complete the task.

After drafting, the owner must run a separate ASD-STE100 and task-level edit pass on its article.

## Owner report

Require each owner to return:

- output path and status: `written` or `blocked`;
- concise `path:line` evidence for every substantive product claim and documented workflow branch;
- unresolved questions, if any; and
- confirmation that it applied the article rules and support policy.

Keep the evidence in the report, not in the customer article.

## 5. Verify each article

After owners finish, dispatch one read-only verifier per written article. A verifier audits exactly one article against the active code and its owner evidence. It must flag every unsupported behavior, incorrect label, missing workflow branch, invalid recovery action, and article-rule violation with article and source lines.

Send accepted findings to a write-capable correction subagent that handles only the affected article. Do not expand article scope. Run the article verifier again after correction. Repeat the correction and verification cycle until the article passes or becomes blocked.

If verification exposes a material ambiguity, restore an existing output from its temporary backup or remove a new output. Confirm the restored file hash when applicable. Add the question to the consolidated list and wait for the user before you resume that article.

This step is complete when each written article passes a factual and procedural audit.

## 6. Run the collection audit

Confirm that:

- every README article has exactly one Markdown file;
- no unlisted article was generated;
- every documented behavior has active-code evidence;
- every procedure contains only necessary user actions and ends with the final user action;
- every field detail meets at least one field-mention criterion;
- troubleshooting contains only verified cases and recovery actions;
- all support directions follow the applicable support policy;
- CrewTraka articles contain no support email address or phone number;
- every blocked existing file retains its pre-run hash;
- every blocked new output remains absent; and
- all unresolved questions are reported.

Scan all target files for URLs, support references, phone numbers, and email addresses. Read every final article in full after the scan.

Report the output files, audit result, and consolidated unresolved questions. Remove the temporary backup only after all articles pass. If the collection is blocked, keep the backup and report its path. The work is complete only when every audit check passes and no unresolved questions remain. Otherwise, report the collection as blocked and list every unresolved question.
