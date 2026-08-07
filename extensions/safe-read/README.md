# Pi Safe Read

A Pi extension that replaces the built-in `read` tool with a guarded wrapper. It preserves Pi's text and image handling, rendering, offsets, and truncation while adding two controls:

- The resolved target must be a regular file. Directories, FIFOs, Unix sockets, block devices, and character devices are rejected before content is read. Symlinks are followed, so symlinks to regular files work and symlinks to special files are rejected.
- Every call has an enforced deadline. The `timeout` argument is measured in seconds and defaults to 10 when omitted.

Regular files in `/tmp` remain valid.

## Install

Run these commands from the repository root:

```bash
npm install --prefix extensions/safe-read
mkdir -p ~/.pi/agent/extensions
ln -s "$(pwd)/extensions/safe-read" ~/.pi/agent/extensions/safe-read
```

Run `/reload` in Pi after installing or updating the extension. Pi warns that the extension overrides the built-in `read` tool; this is expected.

## Usage

Pi uses the override anywhere that `read` is active. Calls can omit the deadline:

```json
{ "path": "README.md" }
```

Or request a different deadline:

```json
{ "path": "large-report.txt", "timeout": 30 }
```

The extension also loads in isolated children created by this repository's `subagent` extension. Those children retain their capability-based tool allowlist, while global extensions can still guard the selected tools.

## Verify

```bash
npm run verify --prefix extensions/safe-read
```

The test suite creates disposable regular files, images, symlinks, FIFOs, and Unix sockets. It does not inspect or remove live application IPC paths.

## Limitations

The guard prevents normal special-file hangs and verifies the opened object again before reading. Portable Node.js filesystem APIs cannot fully defend against a hostile filesystem or guarantee cancellation of an unresponsive kernel, network mount, or FUSE operation.
