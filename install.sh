#!/bin/bash
# Register t3-cards as a user-scope MCP server for Claude Code.
# Usage: ./install.sh [--uninstall] [config-dir ...]
# With no config dirs it uses your default Claude Code config. Pass one or more CLAUDE_CONFIG_DIR folders to
# register it there instead (for example a second account). Safe to run again.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mode=install
if [ "${1:-}" = "--uninstall" ]; then mode=uninstall; shift; fi
dirs=("$@")
[ ${#dirs[@]} -eq 0 ] && dirs=(default)
run() {
  local d="$1"; shift
  if [ "$d" = default ]; then env -u CLAUDECODE -u CLAUDE_CONFIG_DIR claude "$@"
  else env -u CLAUDECODE CLAUDE_CONFIG_DIR="$d" claude "$@"; fi
}
for dir in "${dirs[@]}"; do
  run "$dir" mcp remove -s user t3-cards >/dev/null 2>&1 || true
  if [ "$mode" = install ]; then
    run "$dir" mcp add -s user t3-cards -- node "$here/server.mjs" >/dev/null
    echo "registered t3-cards ($dir)"
  else
    echo "removed t3-cards ($dir)"
  fi
done
