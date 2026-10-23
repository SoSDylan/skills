# Pi Subagent

A Pi extension that delegates one or more parent-generated handoff prompts to isolated child Pi processes. All tasks use the same parallel execution path.

The extension does not define agent personas or load workflow prompt files. The parent decides the role, context, constraints, and expected output for each delegation.

## Install

Run these commands from the repository root:

```bash
npm install --prefix extensions/subagent
mkdir -p ~/.pi/agent/extensions
ln -s "$(pwd)/extensions/subagent" ~/.pi/agent/extensions/subagent
```

Run `/reload` in Pi after installing or updating the extension.

## Usage

Ask Pi to delegate a self-contained task:

> Delegate an inspection of the authentication implementation. Tell the subagent to check `src/auth/`, report concrete security defects with file and line references, and not modify files or run commands that change state.

For parallel work:

> Run two subagents in parallel. Have one review the current change against our coding standards and the other review it against the issue requirements. Give each subagent all relevant context and require file and line references.

The parent calls the `subagent` tool with one or more labeled tasks:

```json
{
  "tasks": [
    {
      "label": "Standards review",
      "prompt": "Review the current change against our coding standards. Read files and inspect Git diffs. Do not modify files, run commands that change state, or create commits. Report concrete findings with file and line references."
    },
    {
      "label": "Specification review",
      "prompt": "Review the current change against the issue requirements in docs/issue.md. Read files and inspect Git diffs. Do not modify files, run commands that change state, or create commits. Report unmet requirements with file and line references."
    }
  ]
}
```

`tasks` must contain from one to eight items. Each task must provide only `label` and `prompt`. All children have access to all tools; the parent defines allowed and prohibited actions in the prompt. Every child inherits the parent's current model and thinking level when the tool is called.

## Handoff prompts

A child does not receive the parent conversation. Each handoff should contain:

1. The goal
2. Relevant context and decisions
3. Relevant paths or commands
4. Constraints, including whether edits are permitted
5. The expected output

The child starts in the parent's working directory and loads Pi's normal context files, including applicable `AGENTS.md` files.

## Model and thinking level

Subagents always use the parent's current model and thinking level. Change these in the parent with `/model` or `/thinking`; subsequent delegations inherit the new settings.

There are no separate subagent selectors or task profiles. The former `/subagents` command is removed. Existing `subagents.json` files are ignored and can be deleted.

## Tool access and permissions

Every child has access to all built-in tools and all tools registered by its loaded extensions. There are no capability profiles or per-task tool allowlists.

The parent must state what the child may and may not do in each handoff. For example: "Read files and inspect Git diffs. Do not modify files, run commands that change state, or create commits." For implementation work, specify which files may change and which commands may run.

These are prompt instructions, not a sandbox. Tool access does not grant permission to act outside the handoff. Global tool guards remain active.

## Execution behavior

- Each child runs as an ephemeral `pi --mode json -p --no-session` process. Global Pi extensions remain active, so tool guards such as `safe-read` and `safe-grep` also protect child processes. At child startup, the extension activates every registered tool. Project-local resources follow Pi's normal trust rules.
- The task list accepts up to eight items and runs at most four concurrently.
- Parent cancellation terminates the delegation. Child cards are display-only and do not have separate cancellation controls.
- A child cannot recursively delegate another subagent.
- Children cannot pause to ask the user questions. Give each child all required context in its handoff.
- Model-visible tool output contains only final child responses. It is limited to Pi's standard 50 KB or 2,000-line limit.

## Live activity

Each child has a separate card. Cards remain in request order and show the label, state, and elapsed time on one header line.

When a child completes, its collapsed card shows the full final response and a usage row with turns, token counts, cost, context utilization, model, and thinking level. While it runs, the card shows the latest eight transcript lines. Use the configured tool-expansion key, `Ctrl+O` by default, to expand or collapse all child cards together.

The expanded view shows the handoff prompt and a chronological activity transcript. Tool calls use compact command-log rows with status, target, result counts, and elapsed time. Expansion adds grep options, full bash commands, recent bash output, and error output; successful read and search payloads stay hidden. Activity also includes streamed prose, model-provided thinking, retries, diagnostics, and final usage. Generated system instructions are not shown.

The rendered activity transcript retains its latest 1,000 lines or 64 KiB per child. The card reports omitted content when this limit is reached. Complete final messages remain in structured tool details even when the rendered activity is truncated.
