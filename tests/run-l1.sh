#!/usr/bin/env bash
# =====================================================================
# Rebuild a scratch database and run the L1 adversarial suite.
#
#   bash tests/run-l1.sh [container-name]
#
# Builds l1_scratch from zero every time:
#   auth/storage schemas  -> platform grants -> migrations -> L1 suite
#
# The container defaults to the running local-stack Postgres. Find it
# with: docker ps --format '{{.Names}}' | grep supabase_db
#
# NEVER point this at a database holding real guest data — the suite
# writes rows into delivery_proofs, which can never be deleted.
# =====================================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1   # stop Git Bash rewriting container paths

CONTAINER="${1:-supabase_db_EventFlow}"
DB=l1_scratch
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

# docker cp needs a WINDOWS path on the host side, but MSYS_NO_PATHCONV
# (required so the container side is not rewritten) also stops Git Bash
# translating /c/... — so translate the host paths explicitly.
if command -v cygpath >/dev/null 2>&1; then
  HERE_HOST="$(cygpath -w "$HERE")"
  ROOT_HOST="$(cygpath -w "$ROOT")"
else
  HERE_HOST="$HERE"
  ROOT_HOST="$ROOT"
fi

psql_db() { docker exec "$CONTAINER" psql -U postgres -d "$1" "${@:2}"; }

echo "==> container: $CONTAINER"

# 1. auth/storage/extensions come from the live local stack, because the
#    migrations assume auth.users and storage.buckets already exist.
if ! docker exec "$CONTAINER" test -f /tmp/bootstrap_auth.sql; then
  echo "==> dumping auth/storage/extensions from the stack's own postgres db"
  docker exec "$CONTAINER" bash -c \
    "pg_dump -U postgres -d postgres --schema-only -n auth -n storage -n extensions > /tmp/bootstrap_auth.sql"
fi

echo "==> recreating $DB"
psql_db postgres -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null

echo "==> auth/storage schemas"
psql_db "$DB" -q -f /tmp/bootstrap_auth.sql >/dev/null 2>&1 || true

echo "==> platform grants (see l1_scratch_bootstrap.sql for why)"
docker cp "$HERE_HOST/l1_scratch_bootstrap.sql" "$CONTAINER:/tmp/l1_scratch_bootstrap.sql" >/dev/null
psql_db "$DB" -q -f /tmp/l1_scratch_bootstrap.sql

echo "==> migrations"
# docker cp into an EXISTING directory nests it (/tmp/migrations/migrations),
# so a stale copy would silently be replayed and a new migration ignored.
docker exec "$CONTAINER" rm -rf /tmp/migrations
docker cp "$ROOT_HOST/supabase/migrations" "$CONTAINER:/tmp/migrations" >/dev/null
echo "    $(docker exec "$CONTAINER" bash -c 'ls /tmp/migrations/*.sql | wc -l') migration files"
docker exec "$CONTAINER" bash -c '
  for f in $(ls /tmp/migrations/*.sql | sort); do
    psql -U postgres -d '"$DB"' -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>&1 \
      || { echo "MIGRATION FAILED: $f"; exit 1; }
  done'

# A scratch DB whose grants do not resemble the real one produces a wall
# of false "denied" results, so refuse to run the suite on a bad build.
GRANTS=$(psql_db "$DB" -tAc \
  "select count(*) from information_schema.role_table_grants where grantee='authenticated' and table_schema='public';")
echo "==> grants to authenticated: $GRANTS"
if [ "$GRANTS" -lt 100 ]; then
  echo "ABORT: too few grants — every denial would be a false pass." >&2
  exit 1
fi

echo "==> running L1"
docker cp "$HERE_HOST/l1_adversarial.sql" "$CONTAINER:/tmp/l1_adversarial.sql" >/dev/null
psql_db "$DB" -q -f /tmp/l1_adversarial.sql
