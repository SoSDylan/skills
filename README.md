# Agent skills and Pi extensions

Reusable agent skills and [Pi](https://github.com/badlogic/pi-mono) extensions.

```text
skills/       Agent skill packages
extensions/   Pi extension packages
```

## Install skills

Clone the repository, then symlink each skill into the directory used by your agent harness:

```bash
git clone https://github.com/SoSDylan/skills.git
cd skills
mkdir -p ~/.agents/skills

for skill in skills/*; do
  ln -s "$(pwd)/$skill" ~/.agents/skills/"$(basename "$skill")"
done
```

Pi discovers `~/.agents/skills/` directly. To install the same skills for Claude Code, repeat the loop with `~/.claude/skills/` as the destination, then restart Claude Code.

## Install Pi extensions

Run the relevant commands from the repository root.

### Hidden skill invoker

This extension is required by `trello-implement-card` and `trello-spec-card`:

```bash
npm install --prefix extensions/hidden-skill-invoker
mkdir -p ~/.pi/agent/extensions
ln -s "$(pwd)/extensions/hidden-skill-invoker" ~/.pi/agent/extensions/hidden-skill-invoker
```

Install each external skill an adapter delegates to in a Pi skill location such
as `~/.agents/skills/`. It must retain `disable-model-invocation: true`. Ensure
Pi's **Skill commands** setting is enabled. See
[`extensions/hidden-skill-invoker/README.md`](extensions/hidden-skill-invoker/README.md)
for exact `/skill:<name>` delegation, hidden-skill verification, draft-only
policy, and continuation behavior.

### Browser tools

```bash
npm install --prefix extensions/browser-tools
mkdir -p ~/.pi/agent/extensions
ln -s "$(pwd)/extensions/browser-tools" ~/.pi/agent/extensions/browser-tools
```

Run `/reload` in Pi after installing or updating an extension. See
[`extensions/browser-tools/README.md`](extensions/browser-tools/README.md) for
browser usage and configuration.

## Skills

### `distill-to-docs`

Distills non-derivable session lessons into the appropriate project agent docs after your review.

### `draft-commits`

Groups uncommitted changes and drafts commit titles that match the repository's existing style.

### `trello-implement-card`

Fetches a ready-to-work Trello card and delegates its implementation workflow.

### `trello-spec-card`

Fetches and clarifies a Trello card, drafts a spec, and publishes the approved result back to the card.

### `zendesk-triage-ticket`

Investigates a Zendesk ticket against the current repository, drafts a customer response, and can prepare an approved Trello card.

## Pi extensions

### `hidden-skill-invoker`

Exposes `invoke_hidden_skill`, a universal bridge for installed hidden skills
that are directly referenced as `/skill:<name>` by another installed skill. It
checks delegation, command provenance, and target frontmatter; draft-only mode
blocks side effects and can queue an explicit adapter continuation after
drafting.

### `browser-tools`

Drives a visible Google Chrome session from Pi with Playwright, including navigation, interaction, accessibility snapshots, console capture, responsive viewport testing, and screenshots returned to vision-capable models. Browser tools are disabled by default; use `/browser on` and `/browser off` to control them per session.

## License

MIT
