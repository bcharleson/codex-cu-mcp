# Validation

Local audit: 2026-10-17, Apple Silicon macOS, Computer Use plugin 26.1007.30912, helper rmcp 1.5.0.

- `npm test`: 28 regression tests pass, covering discovery, transport, consent, tool filtering and execution denial, CLI input and selectors, process cleanup, JSON installer preservation/backups/uninstall, and screenshot correction math.
- Official MCP TypeScript SDK 1.32.1 passed initialization, tool listing, real app inventory, REPL reset, and hidden-tool rejection.
- Existing Claude Code user registration was found and connected successfully.
- Existing Grok Build user registration passed `grok mcp doctor codex-cu`: handshake (2025-11-25), two tools discovered, healthy.
- Real Calculator demo returned 144; screenshot capture and a coordinate click were verified on mixed-resolution displays.
- An isolated Grok config verified that updating the registration preserves the existing app allowlist. Advanced settings the Grok CLI cannot express are protected by refusing a lossy update.
- A packed npm artifact installed in an isolated prefix and its launcher ran.
- Gitleaks 8.30.1 scanned the working tree and all six existing commits with no findings.

`doctor` checks transport and inventory, not every permission or app action. Browser-tab control lacked an extension-connected browser and remains unverified. App consent is distinct from per-action confirmation. No general destructive-action guard is implemented. Interface compatibility depends on the proprietary installed helper and cannot be guaranteed across every future app update.

For the separate shell-only package and its harness acceptance results, see [codex-cu-cli validation](https://github.com/bcharleson/codex-cu-cli/blob/main/docs/validation.md).
