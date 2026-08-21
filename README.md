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

### Subagents

```bash
npm install --prefix extensions/subagent
mkdir -p ~/.pi/agent/extensions
ln -s "$(pwd)/extensions/subagent" ~/.pi/agent/extensions/subagent
```

Run `/reload` in Pi after installation. See
[`extensions/subagent/README.md`](extensions/subagent/README.md) for handoff
prompt guidance, capability profiles, and parallel execution.

### Safe read

```bash
npm install --prefix extensions/safe-read
mkdir -p ~/.pi/agent/extensions
ln -s "$(pwd)/extensions/safe-read" ~/.pi/agent/extensions/safe-read
```

Run `/reload` in Pi after installation. See
[`extensions/safe-read/README.md`](extensions/safe-read/README.md) for behavior,
timeout usage, and verification.

### Safe grep

```bash
npm install --prefix extensions/safe-grep
mkdir -p ~/.pi/agent/extensions
ln -s "$(pwd)/extensions/safe-grep" ~/.pi/agent/extensions/safe-grep
```

Run `/reload` in Pi after installation. See
[`extensions/safe-grep/README.md`](extensions/safe-grep/README.md) for timeout
usage and verification.

## Skills

### `implement`

Implements work from a spec or set of tickets in one bounded implementation,
verification, and stabilization pass.

### `distill-to-docs`

Distills non-derivable session lessons into the appropriate project agent docs after your review.

### `draft-commits`

Groups uncommitted changes and drafts commit titles that match the repository's existing style.

### `keychain-env`

Stores, checks, and removes macOS Keychain credentials and supplies them to commands as environment variables without revealing their values.

### `trello-card-context`

Automatically fetches and reads a pasted Trello card URL, including its description, comments, checklists, custom fields, and attachments, before continuing with the requested task.

### `linear-cli`

Reads and manages Linear issues, comments, labels, workflow states, projects, and relations through Linear's GraphQL API.

### `zendesk-cli`

Fetches complete, read-only Zendesk ticket records, including requester details, comments, and attachments.

### `zendesk-triage-ticket`

Turns a Zendesk ticket into customer-need analysis, a supported response draft, and approval-gated issue-tracker follow-up.

### `write-zendesk-response`

Drafts concise, paste-ready customer replies from established Zendesk support context, either directly or within ticket triage.

## Pi extensions

### `browser-tools`

Drives a visible Google Chrome session from Pi with Playwright, including navigation, interaction, accessibility snapshots, console capture, responsive viewport testing, and screenshots returned to vision-capable models. Browser tools are disabled by default; use `/browser on` and `/browser off` to control them per session.

### `subagent`

Runs parent-generated handoff prompts in isolated Pi processes. It supports read-only or write-capable children, bounded parallel execution, and configurable task profiles. Use `/subagents` to add, edit, or remove model/thinking profiles.

### `safe-read`

Overrides Pi's built-in `read` tool. It rejects non-regular filesystem objects before reading and enforces a per-call timeout that defaults to 10 seconds while preserving built-in text, image, rendering, offset, and truncation behavior.

### `safe-grep`

Overrides Pi's built-in `grep` tool. It enforces a per-call timeout that defaults to 10 seconds while preserving built-in search options, rendering, result shape, and truncation behavior.

## License

MIT
