# How Codex computer use works

These are notes from tracing the computer-use stack the ChatGPT desktop app installs for Codex (plugin version `26.930.31730`, macOS). They describe the behaviour this project relies on. None of OpenAI's code is included here, and internal details can change with any app update.

## The pieces

```text
MCP client ──▶ cua_repl (Node, MCP server "rmcp")
                 │  persistent JavaScript REPL exposing a `cua` object
                 │
                 ├─ computer surface ──unix socket──▶ Codex Computer Use.app (SkyComputerUseService)
                 │                                      native Swift helper: accessibility, screenshots,
                 │                                      input synthesis, the agent cursor overlay
                 │
                 └─ browser surface ──▶ Chrome extension + native-messaging host, in-app browser, MCP Apps
```

| Piece | Where it lives |
| --- | --- |
| Plugin manifest (`cua_repl` command, args, env) | `~/.codex/plugins/cache/openai-bundled/unified-computer-use/<version>/.mcp.json` |
| Node runtime and `@oai/cua-repl`, `@oai/cua`, `@oai/sky`, `@oai/browser-desktop` | `/Applications/ChatGPT.app/Contents/Resources/cua_node/` |
| Native helper | `~/.codex/computer-use/Codex Computer Use.app` (bundle id `com.openai.sky.CUAService`) |
| Helper socket | `~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock` |

The REPL talks to the helper over that socket with length-prefixed JSON-RPC (`CodexComputerUseIPC-5`). Every request carries the Codex turn metadata (`session_id`, `turn_id`, and optionally `thread_id`, `item_id`, `model`).

## The `cua` API

The `js` tool runs JavaScript with `cua` in scope. State persists between calls until `js_reset`.

**Entry points.** The first call after a start or reset must be one of these, on its own:

| Call | Returns |
| --- | --- |
| `cua.getState()` | Inventory: apps (running and recent), browsers, tabs |
| `cua.getApp(nameOrBundleIdOrPath)` | An `App` bound to that app's window, plus its accessibility tree |
| `cua.getTab(...)` / `cua.createBrowserTab(...)` / `cua.getBrowser(...)` | Browser tabs (needs a connected browser) |

**App methods.**

| Method | What it does |
| --- | --- |
| `getAXState({ disableDiffing })` | Accessibility tree as numbered text; later calls return a diff |
| `getScreenshot()` | JPEG of the window |
| `getAXStateAndScreenshot()` | Both |
| `click(indexOr[x, y], { mouseButton, clickCount })` | Left/right/middle, single/double click |
| `drag([x1, y1], [x2, y2])` | Pointer drag |
| `scroll(indexOr[x, y], direction, pages)` | Scroll |
| `typeText(text)` / `pressKey(key)` / `paste(text, { format })` | Keyboard and clipboard (`paste` restores your clipboard) |
| `setValue(index, value)` / `selectText(index, text, opts)` | Direct accessibility edits |
| `performSecondaryAction(index, name)` | Accessibility actions listed in the tree, e.g. `Raise`, `Expand`, `Copy` |

Coordinates are in the pixel space of the latest `getScreenshot()` of that window.

## The agent cursor

The helper draws its own cursor overlay (a "Computer Use Cursor" window), separate from your real mouse, which never moves.

- **Coordinate clicks** (`click([x, y])`) are simulated pointer events. The helper first animates its cursor to the point along a spring-damped path, tilting and stretching as it moves, then clicks. A click takes about 360 ms. This is the fluid, hand-like motion seen in Codex.
- **Element-index clicks** (`click(42)`) are accessibility presses. They finish in about 40 ms and the cursor jumps to the element without animating.
- The overlay is drawn over the target window. If another window covers it, there's nothing to see. `performSecondaryAction(0, "Raise")` brings the window forward (and activates the app).

Codex's model works from screenshots and mostly clicks by coordinates, which is why its cursor looks natural. This project's glide mode (on by default) puts that rule at the top of the `js` tool description so other agents do the same.

The overlay itself is behind an OpenAI feature flag (`feature/computerUseCursor`), evaluated remotely. There's a related flag, `feature/computerUseAlwaysSimulateClick`. Setting it locally makes element clicks real pointer clicks (the button shows a press), but the cursor still jumps, so this project doesn't use it.

## Consent

Before acting on an app, the server asks the MCP client, through an elicitation: `Allow Computer Use to use "<App>"?`. The answer can carry `persist: "session"` or `"always"`, but storing it is the client's job. Codex does that; other clients re-ask on every call unless something caches the answer, which this project's proxy does. Apps that OpenAI's policy blocks or forbids fail before any prompt.

## Browsers

Browser control (`getTab`, `createBrowserTab`) goes through `@oai/browser-desktop`. Every call needs the Codex turn metadata, and Chrome needs the Codex extension plus the `com.openai.codexextension` native-messaging host in that browser's profile. Without them, a browser can still be driven as a native app through `getApp`.
