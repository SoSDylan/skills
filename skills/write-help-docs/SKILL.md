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

- `<help-dir>/README.md` defines the complete article set, suggested investigation areas, and documented routes. Suggested sections are not mandatory headings. Include only relevant, verified content.
- Generate only the listed articles. Write one Markdown file per article in `<help-dir>`.
- Normalize a title or filename stem by lowercasing its alphanumeric words and joining them with hyphens. Preserve an existing filename only when its normalized stem equals the normalized article title. Block target mapping if multiple files match. Otherwise, use the normalized article title as the filename.
- Use pre-existing Markdown articles in `<help-dir>` to derive shared structure and layout. The applicable product reference overrides conflicting editorial patterns. Do not transfer product claims between articles.
- When the user identifies existing content as approved, preserve its active-code-supported substantive meaning and article-specific details. Revise its wording and organization to meet the writing rules. If active code contradicts a substantive approved claim, report the conflict before changing the article.
- If `<help-dir>` has no pre-existing article, use this default layout: H1 title, short introduction, **Before you start** when prerequisites exist, task sections, **What happens next** only for necessary consequences, and **Troubleshooting** when verified recovery content exists.
- Use the current codebase as the source of truth for product behavior.
- Treat browser observations as supporting evidence, not as a replacement for code evidence.
- **CrewTraka:** Read and apply [`references/crewtraka-help-style.md`](references/crewtraka-help-style.md) to every article. It is authoritative for CrewTraka editorial style and support directions.
- **Other products:** Follow the explicit product support policy. Omit support directions when no policy exists.

## 1. Fix the target set

Read `<help-dir>/README.md`, list `<help-dir>`, and read the applicable product reference. Inspect existing mapped outputs for shared structure and layout. Record a concise summary of the structure, layout, product rules, and any user-approved content supplied for the run. Map every listed article to exactly one output file. Create a temporary backup of each existing output file and record its SHA-256 hash. Record which outputs did not exist.

This step is complete when every listed article has one output path, no unlisted article is in scope, and every applicable reference and approved-content baseline is recorded.

## 2. Implementation pass

Dispatch one write-capable owner for each listed article. An owner handles exactly one article and can edit only its output file. Dispatch independent owners in parallel and use batches when the tool has a concurrency limit.

Each owner handoff must include:

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

### Evidence map before drafting

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

This substep is complete when every substantive product claim planned for the article has concise `path:line` evidence.

### Ambiguity gate

An owner completes the evidence map before drafting. If code leaves a material ambiguity, the owner leaves the output file unchanged and reports:

- the exact unresolved question;
- why the answer changes the article;
- the relevant code paths and findings; and
- the missing fact that code does not establish.

An ambiguity is material when it changes scope, prerequisites, permissions, user actions, validation, persistence, side effects, the final action, or failure recovery. Continue work on unaffected articles. Keep an affected existing file unchanged and keep an affected new output absent until the user answers.

### Owner drafting and report

After the evidence map passes, the owner drafts the article and runs separate ASD-STE100, product-style, task-level, and URL/contact edit passes.

The owner report must include:

- output path and status: `written` or `blocked`;
- concise `path:line` evidence for every substantive product claim and documented workflow branch;
- unresolved questions, if any; and
- confirmation that it applied the article rules, ASD-STE100 checklist, product reference, and support policy.

Keep evidence in the report, not in the customer article.

This step is complete when every mapped article has one owner, every written article has an evidence-backed draft, and every owner has reported its status.

## 3. Basic verification pass

Dispatch one read-only verifier for every written article. The verifier audits exactly one article against the active code, the owner evidence, the ASD-STE100 checklist, and the applicable product reference.

The verifier checks:

- every substantive product claim and workflow branch;
- active routes, permissions, states, labels, validation, persistence, side effects, completion indicators, failures, and recovery;
- first task-specific action, final user action, task-level sequencing, and relevant detail;
- exact interface labels and consistent terminology;
- CrewTraka support-link, URL, email, and phone policy; and
- every article rule that the owner reported as applied.

The verifier returns `PASS`, `REVIEW`, or `AMBIGUITY` and reports every finding with:

- article line or section;
- source path and line;
- severity;
- whether code leaves a material ambiguity; and
- a concise explanation of the possible problem.

`REVIEW` means the article has a factual, editorial, or workflow finding that the user should review. `AMBIGUITY` means active code does not establish a material fact needed by the article.

This pass is diagnostic. Do not dispatch a correction subagent. Do not run a second verifier. Do not automatically restore, remove, or rewrite an article because of a verifier finding. Preserve the written outputs and report the findings to the user. The user decides which findings to fix in a later run.

This step is complete when every written article has exactly one basic verification result and every finding is recorded.

## 4. Collection handoff audit

Run one bounded collection audit after the basic verification pass. Do not start another article review or correction pass.

Confirm that:

- every README article has exactly one Markdown file or a reported owner block;
- no unlisted article was generated;
- approved content was preserved or an active-code conflict was reported;
- every documented behavior has active-code evidence in the owner report;
- every detail passes the relevance gate;
- every named field, choice, or visible value meets at least one item-mention criterion;
- troubleshooting contains only verified cases and recovery actions;
- every written article received one basic verification;
- every verifier finding is recorded for the user;
- every blocked existing file retains its pre-run hash;
- every blocked new output remains absent; and
- all unresolved questions are reported.

Run every scan required by the applicable product reference and support policy. For CrewTraka, scan every target article for URLs, support references, email addresses, and phone numbers. Read every written article in full after the scan.

Keep temporary backups while the collection has blocked articles, unresolved questions, or `REVIEW` findings. Remove them only after a later user-approved run resolves the reported findings and the collection passes its audit.

## Article rules

- Follow the source precedence in **Sources and scope**. Preserve approved substantive meaning only within its own article. Do not transfer product claims between topics.
- Read and apply every rule in [`references/asd-ste100-checklist.md`](references/asd-ste100-checklist.md) and the applicable product reference.
- Include a detail only when it helps the reader prepare, choose, complete, verify, understand a necessary consequence, or recover from the task.
- Group routine fields, choices, and visible values at the user-task level. Name an item only when it needs an explanation, has validation or formatting requirements, changes available fields or actions, affects a later step, or is necessary to understand or recover from the workflow.
- Include troubleshooting for code-reachable failure cases and user problems that follow from verified states or validation. Give only recovery actions that the code supports. Describe a problem as common only when support or analytics evidence establishes frequency.
- Keep implementation details and code citations out of the customer article unless the reader needs the detail to complete the task.

## CrewTraka article rules

Apply these rules to every new or revised CrewTraka article:

- Start each procedure with the first task-specific action.
- Include sign-in only when authentication is the task, the authentication method changes the workflow, or the starting state would otherwise be unclear.
- Keep roles and permissions in **Before you start** unless the reader must take an action to obtain or select them.
- Use one verified customer-facing term for each object throughout an article.
- Link every support direction only to [CrewTraka support](https://www.crewtraka.com/support). Do not include a support email address or phone number.
- Use complete sentences in paragraphs and numbered steps. Use exact interface labels.

## Report to the user

Report:

- mapped article titles and output paths;
- which outputs were written, blocked, or retained;
- the collection audit result;
- one basic verification result for every written article;
- every verifier finding, including article and source lines;
- owner questions and unresolved ambiguities;
- residual collection issues; and
- the temporary backup path when the collection is not clean.

End the run after this report. Start a new user-approved run to apply reported fixes.
