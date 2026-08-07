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

> Use a read-only subagent to inspect the authentication implementation. Check `src/auth/` and report concrete security defects with file and line references.

For parallel work:

> Run two subagents in parallel. Have one review the current change against our coding standards and the other review it against the issue requirements. Give each subagent all relevant context and require file and line references.

The parent calls the `subagent` tool with one or more labeled tasks:

```json
{
  "tasks": [
    {
      "label": "Standards review",
      "prompt": "A self-contained standards-review handoff",
      "capability": "read-only",
      "profile": "review"
    },
    {
      "label": "Specification review",
      "prompt": "A self-contained specification-review handoff",
      "profile": "scout"
    }
  ]
}
```

`tasks` must contain from one to eight items. Each task must provide `label` and `prompt`; `capability` is optional and defaults to `read-only`. `profile` is optional and selects a configured model/thinking profile. If omitted, the child inherits the parent's model and thinking level.

## Handoff prompts

A child does not receive the parent conversation. Each handoff should contain:

1. The goal
2. Relevant context and decisions
3. Relevant paths or commands
4. Constraints, including whether edits are permitted
5. The expected output

The child starts in the parent's working directory and loads Pi's normal context files, including applicable `AGENTS.md` files. A selected profile can override the model and thinking level. Otherwise, both are inherited from the parent.

## Task profiles

Use `/subagents` to manage profiles interactively. You can add, edit, and remove profiles. The model picker supports scrolling and fuzzy search. Each profile has:

- a model, entered as `provider/model` or inherited from the parent;
- a thinking level, or inherited from the parent.

The first session provides these defaults:

| Profile | Model | Thinking |
|---|---|---|
| `scout` | Parent model | `low` |
| `review` | Parent model | `medium` |
| `worker` | Parent model | `high` |

Changes are stored in `~/.pi/agent/subagents.json` (or the directory selected by `PI_CODING_AGENT_DIR`). The file uses this shape:

```json
{
  "profiles": {
    "review": {
      "model": "anthropic/claude-sonnet-4-5",
      "thinkingLevel": "medium"
    }
  }
}
```

Use `/subagents list` to display the active profiles. Profile names may contain letters, numbers, `_`, and `-`.

## Capabilities

| Capability | Tools | Notes |
|---|---|---|
| `read-only` | `read`, `grep`, `find`, `ls` | Default. It cannot run shell commands or modify files. Include required diff or command output in the handoff when necessary. |
| `write` | `read`, `grep`, `find`, `ls`, `bash`, `edit`, `write` | Can execute commands and modify the working tree. Use only for delegated implementation work. |

## Execution behavior

- Each child runs as an ephemeral `pi --mode json -p --no-session` process. Global Pi extensions remain active, so tool guards such as `safe-read` also protect child processes. The capability allowlist still controls which tools are active, and project-local resources follow Pi's normal trust rules.
- The task list accepts up to eight items and runs at most four concurrently.
- Parent cancellation terminates the delegation. Child cards are display-only and do not have separate cancellation controls.
- A child cannot recursively delegate another subagent.
- Children cannot pause to ask the user questions. Give each child all required context in its handoff.
- Model-visible tool output contains only final child responses. It is limited to Pi's standard 50 KB or 2,000-line limit.

## Live activity

Each child has a separate card. Cards remain in request order and show the label, capability, state, and elapsed time on one header line.

When a child completes, its collapsed card shows the full final response and a usage row with turns, token counts, cost, context utilization, model, and thinking level. While it runs, the card shows the latest eight transcript lines. Use the configured tool-expansion key, `Ctrl+O` by default, to expand or collapse all child cards together.

The expanded view shows the handoff prompt and a chronological activity transcript. Tool calls use compact command-log rows with status, target, result counts, and elapsed time. Expansion adds grep options, full bash commands, recent bash output, and error output; successful read and search payloads stay hidden. Activity also includes streamed prose, model-provided thinking, retries, diagnostics, and final usage. Generated system instructions are not shown.

The rendered activity transcript retains its latest 1,000 lines or 64 KiB per child. The card reports omitted content when this limit is reached. Complete final messages remain in structured tool details even when the rendered activity is truncated.
