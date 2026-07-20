# Pi Browser Tools

A [Pi](https://github.com/badlogic/pi-mono) extension that drives a visible, persistent Google Chrome session with Playwright. It lets Pi navigate pages, inspect accessibility/DOM snapshots, interact with elements, read console errors, resize the viewport, and return screenshots to vision-capable models.

## Install

```bash
cd browser-tools
npm install
mkdir -p ~/.pi/agent/extensions
ln -s "$(pwd)" ~/.pi/agent/extensions/browser-tools
```

Run `/reload` in Pi after installing or updating the extension. The symlink makes the git-tracked source in this repository the loaded extension.

## Usage

Browser tools are disabled by default so the model cannot overuse them. Enable or disable them for the current session with:

```text
/browser on
/browser off
```

Running `/browser` without an argument reports the current state. Turning browser tools off also closes the managed Chrome session.

## Tools

- `browser_navigate`
- `browser_snapshot`
- `browser_click`
- `browser_type`
- `browser_press`
- `browser_scroll`
- `browser_back`
- `browser_resize`
- `browser_wait`
- `browser_vision`
- `browser_console`
- `browser_close`

`browser_snapshot` assigns refs such as `@e1` to interactive elements. Use those refs with `browser_click`, `browser_type`, and `browser_press`. `browser_vision` returns the screenshot directly to the model and saves a copy under the system temporary directory by default.

## Example prompt

First run `/browser on`, then ask:

> Start my development server, open `http://localhost:3000`, inspect the page at desktop and mobile sizes, check the browser console, take screenshots, fix the visual issues in the source, and repeat until it looks correct.

## Configuration

| Environment variable | Default | Purpose |
|---|---|---|
| `PI_BROWSER_HEADLESS` | `false` | Set to `true` to hide Chrome. |
| `PI_BROWSER_CHANNEL` | `chrome` | Playwright browser channel. |
| `PI_BROWSER_EXECUTABLE_PATH` | unset | Explicit Chrome executable path; overrides channel. |
| `PI_BROWSER_PROFILE_DIR` | `~/.pi/agent/browser-profile` | Primary dedicated persistent browser profile. |
| `PI_BROWSER_PROFILE_ROOT` | `~/.pi/agent/browser-profiles` | Parent directory for isolated profiles used by concurrent agents. |
| `PI_BROWSER_SCREENSHOT_DIR` | OS temporary directory | Default screenshot output directory. |

The primary dedicated profile preserves cookies between sessions. Log in manually when Chrome first opens. If another agent is already using it, the extension automatically retries with an isolated profile under `PI_BROWSER_PROFILE_ROOT`; the navigation result reports the selected path. Avoid pointing either setting at your normal Chrome profile: Chrome profile locks and concurrent access can corrupt browser data.

## Notes

- Google Chrome must be installed locally unless `PI_BROWSER_EXECUTABLE_PATH` points to another Chromium executable.
- Browser actions within one agent are serialized because they share state.
- Concurrent agents use isolated fallback profiles instead of failing on Chrome's `SingletonLock`.
- Pi closes Chrome during session shutdown; profiles remain on disk.
- Screenshots may contain sensitive information and are sent to the selected model when returned by `browser_vision`.
