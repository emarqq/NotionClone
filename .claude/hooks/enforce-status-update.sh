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

STATUS_FILE="STATUS.md"

if [ -f /tmp/.skip-status-check ]; then
  rm -f /tmp/.skip-status-check
  exit 0
fi

# Only enforce this inside a git repo — no-op otherwise.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

# Collect changed paths.
#
# `--porcelain -z` is what makes this correct, and it is worth spelling out:
#   * NUL-terminated records mean a path containing spaces stays one field,
#     so the old `awk '{print $2}'` truncation ("my notes.md" -> "my") is gone.
#   * -z also disables git's C-style quoting/escaping of unusual paths, so a
#     path is delivered verbatim rather than as "\303\251tude.md".
#   * Renames/copies emit TWO NUL-terminated fields: the destination first,
#     then the source. The old parser took the source (or worse, the "->"),
#     so renaming STATUS.md into place never satisfied the check. We read the
#     destination and explicitly consume the source field so the record
#     boundaries stay aligned for every subsequent entry.
#
# Record layout: 2 status chars, a space, then the path.
changed=()
while IFS= read -r -d '' entry; do
  status="${entry:0:2}"
  path="${entry:3}"
  case "$status" in
    R*|C*)
      # Consume (and ignore) the source path of a rename/copy.
      IFS= read -r -d '' _source || true
      ;;
  esac
  changed+=("$path")
done < <(git status --porcelain -z)

# Nothing changed at all this session -> nothing to log, let it stop.
if [ ${#changed[@]} -eq 0 ]; then
  exit 0
fi

# Exact, literal match — no regex, no substring. A file named e.g.
# "docs/STATUS.md" or "STATUSXmd" must not satisfy the check.
for path in "${changed[@]}"; do
  if [ "$path" = "$STATUS_FILE" ]; then
    exit 0
  fi
done

# Something changed, but STATUS.md wasn't one of them -> block the stop.
cat <<'EOF'
{
  "decision": "block",
  "reason": "Files were changed this session but STATUS.md was not updated. Before ending, update STATUS.md: move finished items from 'in progress' to 'built', update 'Next concrete action', and add one line to the Session log with today's date and what changed."
}
EOF
exit 0
