#!/bin/bash
# Stops the Knowledge Hub Next.js server on port 3777.
# Pass --all to also stop the local Supabase stack and colima VM.

set -u
set -o pipefail

REPO_DIR="/Users/erikmarquardt/NotionClone"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/KnowledgeHub.log"
PORT=3777
SUPABASE_BIN="/opt/homebrew/bin/supabase"

mkdir -p "$LOG_DIR"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >>"$LOG_FILE"
}

log "==== stop.sh starting (args: $*) ===="

PIDS=$(lsof -ti TCP:"$PORT" -sTCP:LISTEN 2>/dev/null)
if [ -n "$PIDS" ]; then
  log "next: killing pid(s) on port $PORT: $PIDS"
  kill $PIDS 2>>"$LOG_FILE"
  sleep 1
  # force-kill anything still alive
  STILL=$(lsof -ti TCP:"$PORT" -sTCP:LISTEN 2>/dev/null)
  if [ -n "$STILL" ]; then
    log "next: force-killing pid(s): $STILL"
    kill -9 $STILL 2>>"$LOG_FILE"
  fi
  log "next: server stopped"
else
  log "next: nothing listening on $PORT"
fi

if [ "${1:-}" = "--all" ]; then
  export DOCKER_HOST="unix:///Users/erikmarquardt/.colima/default/docker.sock"
  cd "$REPO_DIR" || true

  log "supabase: stopping..."
  "$SUPABASE_BIN" stop >>"$LOG_FILE" 2>&1
  log "supabase: stop command finished (exit $?)"

  log "colima: stopping..."
  colima stop >>"$LOG_FILE" 2>&1
  log "colima: stop command finished (exit $?)"
fi

log "==== stop.sh done ===="
