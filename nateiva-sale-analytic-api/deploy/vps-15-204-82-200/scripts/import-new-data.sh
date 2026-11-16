#!/usr/bin/env bash
# Runs ON THE NEW VPS (15.204.82.200) via sudo. Imports the old data into the NEW, dedicated DB.
# Refuses to run if the new DB already holds any row (so it can never overwrite live data).
set -Eeuo pipefail
DUMP="${1:?dump.sql.gz required}"; ENV_CONF="${2:?env.conf required}"
source "$ENV_CONF"
[ -f "$ETC_DIR/.managed-by-nateiva-sales-analytics-ci" ] || { echo "environment not deployed yet" >&2; exit 1; }
total=0
for t in $(mysql -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$DB_NAME' AND table_type='BASE TABLE'"); do
  n="$(mysql -N "$DB_NAME" -e "SELECT COUNT(*) FROM \`$t\`")"; total=$((total + n))
done
[ "$total" = 0 ] || { echo "target DB $DB_NAME already has $total rows — refusing to import (no overwrite)" >&2; exit 1; }
gunzip -c "$DUMP" | mysql "$DB_NAME"
echo "=== target row counts ($DB_NAME) ==="
for t in $(mysql -N -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$DB_NAME' AND table_type='BASE TABLE'"); do
  echo "$t $(mysql -N "$DB_NAME" -e "SELECT COUNT(*) FROM \`$t\`")"
done
install -d -m 750 "$STATE_DIR/imports"; mv "$DUMP" "$STATE_DIR/imports/import-$(date +%Y%m%d-%H%M%S).sql.gz"
