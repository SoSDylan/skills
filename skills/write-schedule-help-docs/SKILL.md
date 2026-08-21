---
name: write-schedule-help-docs
description: Generate the Schedule help articles from verified product code.
disable-model-invocation: true
---

# Write Schedule help documentation

Run this workflow from the repository root.

## Sources and scope

- Generate only the articles listed in `../intercom/schedule/README.md`.
- Write one Markdown file per listed article in `../intercom/schedule/`.
- Use the existing files in `../intercom/schedule/` only to identify the documentation structure and layout. Treat their product claims as unverified.
- Use the codebase as the source of truth for all product behavior. Document only behavior that the code proves.
- When an article directs a user to support, link only to [CrewTraka support](https://www.crewtraka.com/support). Exclude support phone numbers. This rule overrides the reference files.

## Workflow

### 1. Fix the target set

Read `../intercom/schedule/README.md`, then inspect the existing Schedule articles for their shared structure and layout. Map each listed article to its Markdown file. Preserve an existing matching filename; otherwise, use the kebab-case article title.

This step is complete when every README article maps to exactly one output file and no other article is in scope.

### 2. Assign article owners

Dispatch one write-capable subagent for each article. A subagent owns exactly one article and can edit only that article's Markdown file. Dispatch independent articles in parallel.

Give each subagent all of this context:

- the article title, suggested sections, and output path;
- the repository root and relevant application areas;
- the Schedule reference directory and its structure-only boundary;
- every writing and procedure rule below;
- the support-link rule;
- the ambiguity protocol and required report below.

Require the subagent to verify the complete workflow before it writes. Its evidence map must cover all applicable items:

- entry point and prerequisites;
- roles and permissions;
- visible states and workflow branches;
- user actions and exact interface labels;
- validation, formatting, conditional fields, and side effects;
- the final persistence action and the code path that handles it;
- relevant completion indicators; and
- verified errors, failure states, and common recovery paths.

The subagent must inspect both frontend and backend code when backend behavior affects the workflow. Comments, existing help articles, and assumptions are not evidence of product behavior.

This step is complete when each article has one owner and each owner returns either a verified article or a blocking ambiguity.

### 3. Handle ambiguity

A subagent must finish its evidence map before it starts the article. If the implementation leaves a material ambiguity, it must leave the affected file unchanged and return:

- the unresolved question;
- why the answer changes the article;
- the relevant code paths and findings; and
- the missing fact that the code does not establish.

Consolidate and deduplicate all questions. Group them by article and return the complete list before drafting any affected article. Resume those articles only after the user supplies the missing facts. Keep unaffected articles in progress.

This step is complete when every affected article remains unchanged and every blocking ambiguity is in one consolidated question list.

## Article rules

- Follow the reference structure and layout.
- Write in strict ASD-STE100. Run a dedicated ASD-STE100 edit pass after drafting.
- Use numbered steps for procedures.
- Write steps at the user-task level. Combine obvious form entry into one step.
- Mention an individual field only when it needs an explanation, has validation or formatting requirements, changes available fields or actions, affects a later step, or is necessary to understand the workflow.
- End each procedure with the final action that the user must take.
- Include a confirmation message only when it contains required information, requires another action, or is the only reliable indication that a long-running process is complete. Omit routine success messages.
- Include troubleshooting for verified failure cases and common problems. Give only recovery actions that the code supports.

## Subagent report

For its one article, require the subagent to return:

- output path and status: written or blocked;
- code evidence as concise `path:line` references for each documented workflow branch;
- unresolved questions, if any; and
- confirmation that it applied the article rules and support-link rule.

Keep evidence in the report. Do not add implementation details or citations to the customer article unless a user needs them to complete the task.

## Final audit

After all blocking questions are resolved, audit every target article against its evidence report and the code. Correct the article through an article-specific subagent if a check fails.

Confirm that:

- every README article has exactly one Markdown file;
- no unlisted article was generated;
- every documented behavior has code evidence;
- each procedure contains only necessary user actions and ends with the final user action;
- field details satisfy at least one field-mention criterion;
- troubleshooting contains only verified cases and recovery actions;
- every support direction uses `https://www.crewtraka.com/support`;
- no support phone number appears; and
- all unresolved questions are reported.

Report the output files, audit result, and consolidated unresolved questions. The work is complete only when every audit check passes and no unresolved question is omitted.
