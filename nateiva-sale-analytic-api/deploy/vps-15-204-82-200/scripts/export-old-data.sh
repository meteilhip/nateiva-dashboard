#!/usr/bin/env bash
# Runs ON THE OLD SERVER (57.129.133.115) via sudo. READ-ONLY: dumps data, changes nothing.
# Writes a gzip'd, data-only SQL dump to stdout and row counts to stderr.
set -Eeuo pipefail
OLD_ENV=/etc/nateiva-sale-analytic/nateiva-sale-analytic-api.env
[ -f "$OLD_ENV" ] || { echo "missing $OLD_ENV on old server" >&2; exit 1; }
set -a; . "$OLD_ENV"; set +a
export MYSQL_PWD="$DB_PASSWORD"
echo "=== source row counts ($DB_NAME) ===" >&2
for t in $(mysql -N -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$DB_NAME' AND table_type='BASE TABLE'"); do
  echo "$t $(mysql -N -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" "$DB_NAME" -e "SELECT COUNT(*) FROM \`$t\`")" >&2
done
# --single-transaction: consistent snapshot without locking the live app.
# --no-create-info / --skip-add-drop-table: data only, no DROP or CREATE statements at all.
mysqldump -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" --single-transaction --no-tablespaces \
  --no-create-info --skip-add-drop-table --skip-triggers --complete-insert "$DB_NAME" | gzip
