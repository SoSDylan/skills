# Pi Safe Grep

A Pi extension that replaces the built-in `grep` tool with a deadline-enforced wrapper. It preserves Pi's ripgrep search behavior, rendering, options, result shape, and truncation while adding a `timeout` argument.

Every call has an enforced deadline. The timeout is measured in seconds and defaults to 10 when omitted. At the deadline, the wrapper aborts the built-in search and returns a timeout error even if the underlying operation does not settle promptly.

## Install

Run these commands from the repository root:

```bash
npm install --prefix extensions/safe-grep
mkdir -p ~/.pi/agent/extensions
ln -s "$(pwd)/extensions/safe-grep" ~/.pi/agent/extensions/safe-grep
```

Run `/reload` in Pi after installing or updating the extension. Pi warns that the extension overrides the built-in `grep` tool; this is expected.

## Usage

Pi uses the override anywhere that `grep` is active. Calls can omit the deadline:

```json
{ "pattern": "createSession", "path": "src" }
```

Or request a different deadline:

```json
{ "pattern": "createSession", "path": "src", "timeout": 30 }
```

The extension also loads in isolated children created by this repository's `subagent` extension. Those children retain their capability-based tool allowlist, while the global override enforces the deadline on selected `grep` calls.

## Verify

```bash
npm run verify --prefix extensions/safe-grep
```

## Limitations

The wrapper ends the tool call at its deadline and requests cancellation from Pi's built-in grep implementation. An unresponsive kernel, network mount, FUSE operation, or other implementation that ignores cancellation can continue underlying work after the tool call returns. As with all in-process JavaScript timers, the deadline cannot interrupt code that blocks the event loop; the wrapper reports the timeout when control returns.
