#!/usr/bin/env bash
# Register codex-cu-mcp as an MCP server with Claude Code and/or Grok.
#
#   ./install.sh                 register with every supported CLI found on PATH
#   ./install.sh --claude        Claude Code only
#   ./install.sh --grok          Grok only
#   ./install.sh --name my-cu    use a different server name (default: codex-cu)
#   ./install.sh --uninstall     remove the registration(s)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$ROOT/bin/codex-cu-mcp"
NAME="codex-cu"
TARGETS=()
UNINSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --claude) TARGETS+=(claude) ;;
    --grok) TARGETS+=(grok) ;;
    --name) NAME="$2"; shift ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  for cli in claude grok; do
    command -v "$cli" >/dev/null 2>&1 && TARGETS+=("$cli")
  done
fi
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  echo "Neither 'claude' nor 'grok' is on PATH. See README.md for manual setup." >&2
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "warning: only macOS has been tested." >&2
fi

for target in "${TARGETS[@]}"; do
  case "$target" in
    claude)
      claude mcp remove "$NAME" -s user >/dev/null 2>&1 || true
      if [[ $UNINSTALL -eq 0 ]]; then
        claude mcp add-json --scope user "$NAME" "{\"type\":\"stdio\",\"command\":\"$BIN\",\"args\":[]}"
      else
        echo "Removed '$NAME' from Claude Code."
      fi
      ;;
    grok)
      grok mcp remove "$NAME" --scope user >/dev/null 2>&1 || true
      if [[ $UNINSTALL -eq 0 ]]; then
        grok mcp add "$NAME" --scope user -- "$BIN"
      else
        echo "Removed '$NAME' from Grok."
      fi
      ;;
  esac
done

if [[ $UNINSTALL -eq 0 ]]; then
  echo
  "$BIN" doctor || true
  echo
  echo "Restart Claude Code / Grok to load the '$NAME' tools."
fi
