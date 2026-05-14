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

## License

MIT
