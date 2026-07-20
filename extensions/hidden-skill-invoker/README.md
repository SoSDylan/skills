# Pi Hidden Skill Invoker

A universal Pi extension that lets one skill delegate to another hidden user-invoked skill without changing its `disable-model-invocation: true` frontmatter.

The delegating `SKILL.md` must directly name the target with the exact `/skill:<name>` format. Before queueing, the tool scans other installed skill bodies for that exact reference, verifies that Pi exposes the target command with `source: "skill"`, and re-reads the target `SKILL.md` to require a matching frontmatter name and `disable-model-invocation: true`. Self-references, shorthand `/name` references, missing references, visible skills, malformed names, and non-skill commands are rejected.

## Install

Run from this repository's root:

```bash
npm install --prefix extensions/hidden-skill-invoker
mkdir -p ~/.pi/agent/extensions
ln -s "$(pwd)/extensions/hidden-skill-invoker" ~/.pi/agent/extensions/hidden-skill-invoker
```

Install each external skill an adapter delegates to in a Pi skill location such as `~/.agents/skills/`, keep `disable-model-invocation: true`, and ensure Pi's **Skill commands** setting is enabled. Run `/reload` after installation or updates.

## Tool

`invoke_hidden_skill` accepts:

- `skill` — an installed hidden skill name directly referenced as `/skill:<name>` by another installed skill
- `input` — multiline context appended to the skill
- `continuation` — optional follow-up queued after a drafting skill finishes

A delegation with no continuation uses the active toolset unchanged. Supplying a continuation permits only `read`, `grep`, `find`, and `ls` during the delegated run. All other tool calls—including shell commands, file mutation, tracker tools, and recursive hidden-skill invocation—are blocked. This lets an adapter retain publication ownership before control returns to it.

The continuation is queued from `agent_end`. This supports explicit multi-stage flows such as:

```text
/skill:grill-with-docs → /skill:to-spec → adapter validation and approval
```

The grilling invocation tells the model when and how to invoke `/skill:to-spec`; that invocation supplies the continuation that resumes the adapter.

## Compatibility note

Pi 0.80.7's `sendUserMessage()` skips slash-command expansion, even though the extension documentation's reload bridge queues slash commands this way. The extension therefore intercepts only its own exact extension-originated, already verified hidden `/skill:<name>` message and expands it using the command's canonical `sourceInfo.path`. User input, visible skills, and arbitrary extension messages are never expanded by this hook.

No shell quoting is involved. Multiline and Unicode card content is passed as an in-memory user message.

## Development

```bash
npm test --prefix extensions/hidden-skill-invoker
npm run check --prefix extensions/hidden-skill-invoker
```
