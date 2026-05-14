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

Fetches a Trello card by URL and writes pre-work questions back to the card description before any implementation begins. Questions are organised into three sections — for the client, for management, and for developers — covering scope, acceptance criteria, edge cases, and technical decisions. Trigger it by pasting a Trello card URL and saying "grill this", "prep this card", or similar.

**Trigger:** paste a Trello card URL + "grill", "prep", or "what do I need to figure out before starting this?"

```
/trello-grill-card https://trello.com/c/SHORTLINK/card-name
```

---

### `trello-implement-card`

Fetches a Trello card that has been prepped by `trello-grill-card` (with answered Q&A sections), synthesises requirements from all three answer sections, then implements the work. It reads the original spec, extracts client/management/developer answers, warns on unanswered sections, and reports what was changed.

**Trigger:** paste a Trello card URL + "implement", "do this card", "ship this", or similar.

```
/trello-implement-card https://trello.com/c/SHORTLINK/card-name
```

---

### `distill-to-docs`

Scans the current conversation for non-obvious commands, patterns, and corrections — things that can't be found by exploring the codebase — and appends them to `CLAUDE.md` or `AGENTS.md`. Proposes additions for your review before writing anything. Use it at the end of sessions where you corrected Claude's approach or revealed project-specific patterns worth preserving.

**Trigger:** "update docs", "distill this session", "capture learnings", "add to CLAUDE.md"

```
/distill-to-docs
```

---

## License

MIT
