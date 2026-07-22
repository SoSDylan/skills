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

### `trello-card-context`

Automatically fetches and reads a pasted Trello card URL, including its description, comments, checklists, custom fields, and attachments, before continuing with the requested task.

### `zendesk-triage-ticket`

Investigates a Zendesk ticket against the current repository, drafts a customer response, and can prepare an approved Trello card.

## Pi extensions

### `browser-tools`

Drives a visible Google Chrome session from Pi with Playwright, including navigation, interaction, accessibility snapshots, console capture, responsive viewport testing, and screenshots returned to vision-capable models. Browser tools are disabled by default; use `/browser on` and `/browser off` to control them per session.

## License

MIT
