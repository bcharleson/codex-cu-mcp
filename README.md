# codex-cu-mcp

Use **Codex's computer use** from **Claude Code, Grok, or any MCP client** on macOS.

The ChatGPT desktop app ships a computer-use MCP server (`cua_repl`) that Codex uses to operate Mac apps and browsers. It works through the accessibility tree, so it runs **in the background**: it clicks and reads apps without taking over your mouse or bringing windows to the front.

This repo is a small launcher, proxy and CLI that let other agents use that server, including the **gliding agent cursor** you see in Codex. It doesn't contain or redistribute any OpenAI code. It runs the copy already installed on your Mac.

```text
> Use codex-cu to work out 12 × 12 in Calculator in the background.

  cua.getApp("Calculator") → click AC, 1, 2, ×, 1, 2, =
  Calculator: 12 × 12 = 144      (your frontmost app never changed)
```

## Requirements

- macOS
- The **ChatGPT desktop app** with Codex, with **Computer Use enabled once inside Codex**. That installs the plugin under `~/.codex/plugins/cache/openai-bundled/unified-computer-use/` and the "Codex Computer Use" helper, and grants it the macOS Accessibility and Screen Recording permissions.
- [Claude Code](https://claude.com/claude-code) and/or the [Grok CLI](https://x.ai) (or any MCP client that runs stdio servers)

No Node install is needed; the launcher uses the Node runtime bundled with the ChatGPT app.

## Quick start

```bash
git clone https://github.com/bcharleson/codex-cu-mcp.git
cd codex-cu-mcp
./install.sh                  # registers "codex-cu" with Claude Code and Grok
./bin/codex-cu-mcp doctor     # checks the install
./bin/codex-cu-mcp demo       # 12 × 12 in Calculator, in the background
./bin/codex-cu-mcp demo --show   # same, with the window raised so you can watch the cursor glide
```

Restart Claude Code or Grok, then ask for something like *"Use codex-cu to read the title of the frontmost Chrome tab"*.

The tools appear as `mcp__codex-cu__js` in Claude Code and `codex-cu__js` in Grok.

## Manual setup

The registered command is the launcher; it takes no arguments and finds the newest plugin version at startup, so ChatGPT updates don't need a re-install.

**Claude Code**

```bash
claude mcp add-json --scope user codex-cu \
  '{"type":"stdio","command":"/path/to/codex-cu-mcp/bin/codex-cu-mcp","args":[]}'
```

**Grok**

```bash
grok mcp add codex-cu -- /path/to/codex-cu-mcp/bin/codex-cu-mcp
```

or in `~/.grok/config.toml`:

```toml
[mcp_servers.codex-cu]
command = "/path/to/codex-cu-mcp/bin/codex-cu-mcp"
startup_timeout_sec = 120
```

**Any other MCP client** (Cursor, Claude Desktop, …)

```json
{
  "mcpServers": {
    "codex-cu": { "command": "/path/to/codex-cu-mcp/bin/codex-cu-mcp" }
  }
}
```

## How agents use it

The server exposes one main tool, `js`, which runs JavaScript in a persistent REPL with a `cua` object. Its tool description and first-call result carry full documentation, so agents generally need no extra prompting. The basics:

```js
// First call after start or js_reset: exactly one entry call.
let app = await cua.getApp("Calculator");   // returns docs + the accessibility tree

// Then act on element indices from that tree and re-read the state.
await app.click(20);
await app.getAXState();
```

Other entry points: `cua.getState()` (inventory of apps, browsers and tabs), `cua.getTab(...)` and `cua.createBrowserTab(...)` for browsers. `js_reset` clears the REPL.

## The agent cursor

Computer Use draws its own cursor over the target window; your real mouse never moves. How it moves depends on how the agent clicks:

| Click | Cursor | Time |
| --- | --- | --- |
| `app.click([x, y])` (screenshot coordinates) | **Glides** to the target along a smooth, hand-like path | ~360 ms |
| `app.click(42)` (element index) | Jumps; it's an instant accessibility press | ~40 ms |

**Glide mode** (on by default, `CODEX_CU_GLIDE=0` turns it off) makes agents click by coordinates:

- the rule leads the `js` tool description and the server instructions;
- if an agent still clicks by element index, the wrapper adds a one-line note to that call's result telling it the cursor jumped and how to make it glide.

In testing, headless Claude Code and Grok both clicked by coordinates from a plain prompt ("work out 9 × 4 in Calculator"). For comparison, headless `codex exec` clicked by element index, so its cursor jumped. Agents are also told to **leave your screen as it is**: they work on windows where they are and don't raise or activate them, so your own app keeps focus. The glide is visible whenever the target window isn't covered. If you want to watch a hidden window, ask the agent to bring it forward, or use `--show` on the CLI; that does activate the app.

See [docs/how-it-works.md](docs/how-it-works.md) for the full API and what's going on underneath.

## CLI

Every Computer Use action is also available from the shell, for agents and scripts that don't speak MCP. Each command binds the app, acts, and prints the updated accessibility tree.

```bash
codex-cu-mcp apps                              # running and recent apps
codex-cu-mcp state "Google Chrome"             # accessibility tree with element indices
codex-cu-mcp screenshot Calculator -o calc.png
codex-cu-mcp click Calculator 392,745 --show   # coordinate click: the cursor glides
codex-cu-mcp click Calculator 9                # element click
codex-cu-mcp click Finder 300,200 --double     # also --right
codex-cu-mcp type TextEdit "hello"
codex-cu-mcp key TextEdit cmd+a
codex-cu-mcp paste Notes "multi-line text"
codex-cu-mcp scroll Safari 400,300 down 2
codex-cu-mcp drag Finder 100,100 400,100
codex-cu-mcp set "System Settings" 12 "value"
codex-cu-mcp action Calculator 0 Raise
codex-cu-mcp js --app Calculator 'await app.click([176, 317]); await app.getAXState();'
```

`--show` raises the window first so you can watch; `--quiet` skips printing the tree.

## App approvals

The server asks for consent per app (`Allow Computer Use to use "Calculator"?`). The proxy handles it like this:

| Client | Behaviour |
| --- | --- |
| Supports MCP elicitation (Claude Code, interactive Grok) | You're asked **once per app per session**; later actions on that app reuse the answer. |
| No elicitation support, or `CODEX_CU_ASK=never` | `CODEX_CU_AUTO_APPROVE` decides. The default is `all`. |

Headless Grok can't answer prompts, so run it with `CODEX_CU_ASK=never` (Grok passes its environment to MCP servers):

```bash
CODEX_CU_ASK=never grok -p "Use codex-cu to work out 9 × 7 in Calculator" --allow "codex-cu__js"
```

> **Security note:** with `CODEX_CU_AUTO_APPROVE=all`, an agent using a client without elicitation can operate any app on your Mac, including Mail, Messages and browsers with your signed-in sessions. Set an allowlist if that's not what you want. Apps that OpenAI's policy blocks or forbids stay blocked either way. Auto-approval covers app access only; other prompts, such as recording computer audio, are always declined unless a client can show them to you.

```bash
CODEX_CU_AUTO_APPROVE="Calculator,Google Chrome"   # only these apps
CODEX_CU_AUTO_APPROVE=none                         # decline everything
```

## Browsers

There are two ways to drive a browser:

1. **As a native app.** Works with any browser right away: `cua.getApp("Google Chrome")` exposes the window, address bar, tab strip and page content through accessibility.
2. **Tab-level control.** Codex's richer browser API (`cua.getTab`, `cua.createBrowserTab`) needs the Codex Chrome extension and its native-messaging host in that browser. `doctor` reports which browsers are connected.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEX_CU_AUTO_APPROVE` | `all` | Approval policy for clients without elicitation: `all`, `none`, or a comma-separated list of app names |
| `CODEX_CU_ASK` | `client` | `never` stops forwarding approval prompts to the client and applies `CODEX_CU_AUTO_APPROVE` instead. Needed for headless runs such as `grok -p`, which advertise elicitation but cancel it |
| `CODEX_CU_GLIDE` | `1` | Tell agents to click at screenshot coordinates so the cursor glides. `0` turns it off |
| `CODEX_CU_TOOLS` | `js,js_reset` | Tools to expose (the server also has `js_add_node_module_dir` and the Codex-only `turn_ended`) |
| `CODEX_CU_NODE` | ChatGPT's bundled Node | Node runtime for the launcher |
| `CODEX_HOME` | `~/.codex` | Where to look for the Codex plugin cache |
| `CODEX_CU_VERBOSE` | unset | Set to `1` to log plugin version and client capabilities to stderr |

## How it works

```text
MCP client ──stdio──▶ bin/codex-cu-mcp ──▶ lib/proxy.mjs ──stdio──▶ cua_repl (ChatGPT.app)
 (Claude Code, Grok)                                                   └▶ Codex Computer Use service
```

On each start the launcher reads the newest `unified-computer-use/<version>/.mcp.json`, takes the `cua_repl` command, args and env, and starts it. The proxy passes JSON-RPC through and fills in the parts Codex normally provides:

- **Turn metadata.** Browser control rejects calls without `_meta["x-codex-turn-metadata"]` (`session_id`, `turn_id`). The proxy adds one per session.
- **Consent.** It always tells the server it supports elicitation, then forwards or answers approval prompts as described above.
- **Tool list.** It hides the Codex-internal tools and, in glide mode, leads the `js` description with the coordinate-click rule.

## Troubleshooting

- **`plugin not found`**: open the ChatGPT app, go to Codex, and enable Computer Use once.
- **`nodeRepl.createElicitation is unavailable`**: you're running the server directly rather than through `bin/codex-cu-mcp`.
- **`Missing required Codex turn metadata`**: same cause; register the launcher, not the raw `cua_repl` command.
- **The cursor jumps instead of gliding**: the agent clicked by element index. Keep `CODEX_CU_GLIDE` on, or ask it to click with screenshot coordinates.
- **I can't see the cursor**: the target window is covered. Raise it, or use `--show`.
- **Headless Grok says Computer Use wasn't approved**: set `CODEX_CU_ASK=never`.
- **Grok times out at startup**: raise `startup_timeout_sec` (see above) or set `MCP_TIMEOUT=120000`.
- **Clicks do nothing**: check System Settings → Privacy & Security → Accessibility and Screen Recording for "Codex Computer Use".

## Disclaimer

This is an unofficial community project. It isn't affiliated with or endorsed by OpenAI, Anthropic or xAI. It relies on internal, undocumented interfaces of the ChatGPT app that can change in any update. Review OpenAI's terms before using their bundled components outside Codex.

## License

MIT
