#!/usr/bin/env bash
# A throwaway PostgreSQL 18 shaped like Aiven's: the app connects as a
# non-superuser `avnadmin` (CREATEROLE, CREATEDB, BYPASSRLS) that owns `defaultdb`.
#   scripts/aiven/local-db.sh up      start (fresh) on localhost:55432
#   scripts/aiven/local-db.sh down    remove it
set -euo pipefail
NAME=pintora-pg
case "${1:-up}" in
  up)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:18-alpine >/dev/null
    for _ in $(seq 1 30); do
      docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
      sleep 1
    done
    docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -U postgres >/dev/null <<'SQL'
CREATE ROLE avnadmin LOGIN PASSWORD 'local' CREATEROLE CREATEDB BYPASSRLS REPLICATION;
CREATE DATABASE defaultdb OWNER avnadmin;
SQL
    echo "postgresql://avnadmin:local@localhost:55432/defaultdb"
    ;;
  down)
    docker rm -f "$NAME" >/dev/null
    ;;
esac
