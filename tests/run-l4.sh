#!/usr/bin/env bash
# =====================================================================
# Rebuild a scratch database and run the L4 caller-lock suite.
#
#   bash tests/run-l4.sh [container-name]
#   REBUILD=1 bash tests/run-l4.sh        force a template rebuild
#
# Two databases, so the loop stays fast enough to iterate against:
#   l4_tmpl     auth/storage + platform grants + every migration. Built
#               once, then reused. Rebuild it after adding a migration
#               (REBUILD=1, or just delete the database).
#   l4_scratch  recreated FROM TEMPLATE on every run — a few hundred ms
#               instead of replaying 46 migrations, and byte-identical
#               each time, so the verdict is deterministic.
#
# The container defaults to the running local-stack Postgres. Find it
# with: docker ps --format '{{.Names}}' | grep supabase_db
#
# NEVER point this at a database holding real guest data.
# =====================================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1   # stop Git Bash rewriting container paths

CONTAINER="${1:-${CONTAINER:-supabase_db_Nuvent}}"
TMPL=l4_tmpl
DB=l4_scratch

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

# A cached template that predates a new migration would pass silently and
# for the wrong reason — the exact false-green this suite exists to catch.
# So the template carries a fingerprint of the migration set it was built
# from (stored as the database comment), and is rebuilt when it drifts.
FINGERPRINT=$(cd "$ROOT/supabase/migrations" && ls -la *.sql | md5sum | cut -d' ' -f1)

TMPL_FINGERPRINT=$(psql_db postgres -tAc \
  "select shobj_description(oid, 'pg_database') from pg_database where datname='$TMPL';" \
  2>/dev/null | tr -d '[:space:]' || echo "")

if [ "${REBUILD:-0}" = "1" ] || [ "$TMPL_FINGERPRINT" != "$FINGERPRINT" ]; then
  if [ -n "$TMPL_FINGERPRINT" ] && [ "$TMPL_FINGERPRINT" != "$FINGERPRINT" ]; then
    echo "==> migration set changed since the template was built — rebuilding"
  fi
  echo "==> building template $TMPL (this is the slow path; reused afterwards)"

  # auth/storage/extensions come from the live local stack, because the
  # migrations assume auth.users and storage.buckets already exist.
  docker exec "$CONTAINER" bash -c \
    "pg_dump -U postgres -d postgres --schema-only -n auth -n storage -n extensions > /tmp/l4_bootstrap_auth.sql"

  psql_db postgres -q -c "drop database if exists $DB;" >/dev/null
  psql_db postgres -q -c "drop database if exists $TMPL;" -c "create database $TMPL;" >/dev/null
  psql_db "$TMPL" -q -f /tmp/l4_bootstrap_auth.sql >/dev/null 2>&1 || true

  # See l1_scratch_bootstrap.sql for why the grants matter: without them
  # every denial below is a false pass, because `authenticated` cannot
  # touch any table at the privilege layer and RLS is never consulted.
  echo "==> platform grants"
  docker cp "$HERE_HOST\\l1_scratch_bootstrap.sql" "$CONTAINER:/tmp/l4_grants.sql" >/dev/null
  psql_db "$TMPL" -q -f /tmp/l4_grants.sql

  echo "==> migrations"
  docker exec "$CONTAINER" rm -rf /tmp/l4_migrations
  docker cp "$ROOT_HOST\\supabase\\migrations" "$CONTAINER:/tmp/l4_migrations" >/dev/null
  echo "    $(docker exec "$CONTAINER" bash -c 'ls /tmp/l4_migrations/*.sql | wc -l') migration files"
  docker exec "$CONTAINER" bash -c '
    for f in $(ls /tmp/l4_migrations/*.sql | sort); do
      psql -U postgres -d '"$TMPL"' -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>&1 \
        || { echo "MIGRATION FAILED: $f"; exit 1; }
    done'

  GRANTS=$(psql_db "$TMPL" -tAc \
    "select count(*) from information_schema.role_table_grants where grantee='authenticated' and table_schema='public';")
  echo "==> grants to authenticated: $GRANTS"
  if [ "$GRANTS" -lt 100 ]; then
    echo "ABORT: too few grants — every denial would be a false pass." >&2
    exit 1
  fi

  # Stamp LAST, so an interrupted build leaves no fingerprint and the next
  # run rebuilds rather than trusting a half-built template.
  psql_db postgres -q -c "comment on database $TMPL is '$FINGERPRINT';" >/dev/null
fi

psql_db postgres -q -c "drop database if exists $DB;" \
                 -c "create database $DB template $TMPL;" >/dev/null

echo "==> running L4"
docker cp "$HERE_HOST\\l4_lock_release.sql" "$CONTAINER:/tmp/l4_lock_release.sql" >/dev/null
psql_db "$DB" -q -v ON_ERROR_STOP=1 -f /tmp/l4_lock_release.sql
