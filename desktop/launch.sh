#!/bin/bash
# Knowledge Hub desktop launcher.
# Boots colima + local Supabase + the Next.js production server (if not
# already running), waits for the server to answer, then opens the app in
# its own chromeless browser window. Safe to run repeatedly (idempotent).

set -u
set -o pipefail

REPO_DIR="/Users/erikmarquardt/NotionClone"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/KnowledgeHub.log"
PORT=3777
APP_URL="http://127.0.0.1:${PORT}"
SUPABASE_BIN="/opt/homebrew/bin/supabase"

mkdir -p "$LOG_DIR"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >>"$LOG_FILE"
}

log "==== launch.sh starting ===="

export DOCKER_HOST="unix:///Users/erikmarquardt/.colima/default/docker.sock"
log "DOCKER_HOST set to $DOCKER_HOST"

# --- 1. Colima ---------------------------------------------------------
if colima status >>"$LOG_FILE" 2>&1; then
  log "colima: already running"
else
  log "colima: not running, starting..."
  if colima start >>"$LOG_FILE" 2>&1; then
    log "colima: started ok"
  else
    log "colima: FAILED to start"
    exit 1
  fi
fi

# --- 2. Supabase local stack --------------------------------------------
cd "$REPO_DIR" || { log "FATAL: cannot cd to $REPO_DIR"; exit 1; }

if "$SUPABASE_BIN" status >>"$LOG_FILE" 2>&1; then
  log "supabase: already running"
else
  log "supabase: not running, starting..."
  if "$SUPABASE_BIN" start >>"$LOG_FILE" 2>&1; then
    log "supabase: started ok"
  else
    log "supabase: FAILED to start"
    exit 1
  fi
fi

# --- 3. Next.js production server on 3777 --------------------------------
if lsof -i TCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  log "next: something already listening on $PORT, reusing it"
else
  log "next: nothing listening on $PORT"
  if [ ! -f "$REPO_DIR/.next/BUILD_ID" ]; then
    log "next: no build found (.next/BUILD_ID missing), running npm run build..."
    if (cd "$REPO_DIR" && npm run build) >>"$LOG_FILE" 2>&1; then
      log "next: build succeeded"
    else
      log "next: BUILD FAILED"
      exit 1
    fi
  fi

  log "next: starting production server on port $PORT..."
  (cd "$REPO_DIR" && nohup npx next start -p "$PORT" >>"$LOG_FILE" 2>&1 &)
fi

# --- 4. Wait for the server to answer ------------------------------------
log "waiting for $APP_URL to respond..."
READY=0
for i in $(seq 1 180); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$APP_URL" 2>/dev/null)
  if [ "$CODE" = "200" ] || [ "$CODE" = "307" ] || [ "$CODE" = "302" ] || [ "$CODE" = "308" ]; then
    log "next: server ready after ${i}s (HTTP $CODE)"
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  log "ERROR: timed out after 180s waiting for $APP_URL to respond"
  exit 1
fi

# --- 5. Open the app window ----------------------------------------------
open_app_window() {
  local candidates=(
    "/Applications/Google Chrome.app"
    "/Applications/Chromium.app"
    "/Applications/Brave Browser.app"
    "/Applications/Microsoft Edge.app"
  )
  for app in "${candidates[@]}"; do
    if [ -d "$app" ]; then
      log "opening app window via: $app"
      open -na "$app" --args --app="$APP_URL" >>"$LOG_FILE" 2>&1
      return $?
    fi
  done
  log "no chromium-family browser found, falling back to 'open $APP_URL'"
  open "$APP_URL" >>"$LOG_FILE" 2>&1
}

open_app_window
OPEN_STATUS=$?
log "open exit status: $OPEN_STATUS"
log "==== launch.sh done ===="
exit "$OPEN_STATUS"
