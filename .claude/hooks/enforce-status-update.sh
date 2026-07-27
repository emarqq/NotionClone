#!/usr/bin/env bash
# Claude Code "Stop" hook: prevents ending a session without touching STATUS.md
# whenever other files in the project were actually changed.
#
# Install:
#   1. Copy this file to .claude/hooks/enforce-status-update.sh in your project
#   2. chmod +x .claude/hooks/enforce-status-update.sh
#   3. Add to .claude/settings.json:
#      {
#        "hooks": {
#          "Stop": [
#            { "matcher": "*", "hooks": [{ "type": "command", "command": ".claude/hooks/enforce-status-update.sh" }] }
#          ]
#        }
#      }
#
# Bypass for a session that genuinely made no code changes:
#   touch /tmp/.skip-status-check   (auto-removed after one use)

set -euo pipefail

if [ -f /tmp/.skip-status-check ]; then
  rm -f /tmp/.skip-status-check
  exit 0
fi

# Only enforce this inside a git repo — no-op otherwise.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

CHANGED_FILES="$(git status --porcelain | awk '{print $2}')"

# Nothing changed at all this session -> nothing to log, let it stop.
if [ -z "$CHANGED_FILES" ]; then
  exit 0
fi

# Something changed, but STATUS.md wasn't one of them -> block the stop.
if ! echo "$CHANGED_FILES" | grep -q "^STATUS.md$"; then
  cat <<'EOF'
{
  "decision": "block",
  "reason": "Files were changed this session but STATUS.md was not updated. Before ending, update STATUS.md: move finished items from 'in progress' to 'built', update 'Next concrete action', and add one line to the Session log with today's date and what changed."
}
EOF
  exit 0
fi

exit 0
