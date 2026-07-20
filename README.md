# skills

Custom skills for [Claude Code](https://claude.ai/code). Skills are markdown files that extend Claude Code with reusable, triggerable workflows.

## Install

Clone this repo and symlink (or copy) the skill folders into `~/.claude/skills/`:

```bash
git clone https://github.com/SoSDylan/skills.git
cd skills

# symlink each skill
ln -s "$(pwd)/trello-grill-card" ~/.claude/skills/trello-grill-card
ln -s "$(pwd)/trello-implement-card" ~/.claude/skills/trello-implement-card
ln -s "$(pwd)/distill-to-docs" ~/.claude/skills/distill-to-docs
```

Restart Claude Code after installing.

### Pi browser extension

```bash
cd browser-tools
npm install
mkdir -p ~/.pi/agent/extensions
ln -s "$(pwd)" ~/.pi/agent/extensions/browser-tools
```

Run `/reload` in Pi. See [`browser-tools/README.md`](browser-tools/README.md) for usage and configuration.

---

## Skills

### `trello-grill-card`

Fetches a Trello card and writes scoped pre-work questions (client, management, developer) back to the card description before implementation begins.

---

### `trello-implement-card`

Fetches an answered Trello card, synthesises requirements from all Q&A sections, and implements the work.

---

### `distill-to-docs`

Scans the current session for non-obvious corrections and patterns, then appends them to `CLAUDE.md` or `AGENTS.md` after your review.

---

## Pi extensions

### `browser-tools`

Drives a visible Google Chrome session from Pi with Playwright, including navigation, interaction, accessibility snapshots, console capture, responsive viewport testing, and screenshots returned to vision-capable models. Browser tools are disabled by default; use `/browser on` and `/browser off` to control them per session.

---

## License

MIT
