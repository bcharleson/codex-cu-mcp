#!/usr/bin/env bash
# Register codex-cu-mcp from a git checkout. Same as `codex-cu-mcp install`;
# see `codex-cu-mcp help` for options (--claude, --grok, --name, --uninstall).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$ROOT/bin/codex-cu-mcp" install "$@"
