#!/usr/bin/env bash
#
# Bring up a DISPOSABLE Postgres container and replay supabase/migrations into it,
# for the DB-backed test suite (hybrid_search).
#
# WHY A SCRATCH CONTAINER: the project's real local Supabase stack holds Erik's
# actual, un-backed-up notes, and `supabase db reset` is forbidden (see the
# CAUTION block in CLAUDE.md). These tests need to INSERT fixture rows, so they
# must never point at the real database. This script stands up a throwaway one
# on a different port and the tests only ever talk to that.
#
# Idempotent: reuses the container if it is already running and schema-loaded.
#
#   tests/db/setup-scratch-db.sh          # create/reuse
#   tests/db/setup-scratch-db.sh --down   # tear down
#
set -euo pipefail

CONTAINER="nc_test_pg"
PORT="54329"
# Match the image of the real stack so we test the same Postgres/pgvector build.
IMAGE="public.ecr.aws/supabase/postgres:17.6.1.140"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# colima's socket — docker is not on the default socket on this machine.
if [ -z "${DOCKER_HOST:-}" ] && [ -S "$HOME/.colima/default/docker.sock" ]; then
  export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
fi

if [ "${1:-}" = "--down" ]; then
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  echo "removed $CONTAINER"
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo "docker-unavailable" >&2
  exit 3
fi

# Already up AND schema-loaded? Reuse it.
if docker exec "$CONTAINER" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
  if docker exec "$CONTAINER" psql -U postgres -d postgres -tAc \
      "select to_regprocedure('hybrid_search(text,vector,uuid,int)') is not null" 2>/dev/null | grep -q '^t$'; then
    echo "reused"
    exit 0
  fi
fi

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=postgres \
  -p "${PORT}:5432" \
  "$IMAGE" >/dev/null

for _ in $(seq 1 90); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres -d postgres >/dev/null

# The image provisions the auth/storage SCHEMAS and the anon/authenticated/
# service_role ROLES, but not the storage TABLES (storage-api creates those at
# stack boot). The initial migration inserts into storage.buckets, so stub them
# first. Must run as supabase_admin, connected to -d postgres.
docker exec -i "$CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now()
);
alter table storage.buckets owner to postgres;
alter table storage.objects owner to postgres;
SQL

# Replay every migration in filename order. ON_ERROR_STOP + the explicit exit
# code check matter: piping psql through head/grep would mask a failure.
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  if ! docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$f"; then
    echo "migration failed: $(basename "$f")" >&2
    exit 1
  fi
done

echo "created"
