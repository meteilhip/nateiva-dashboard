#!/usr/bin/env bash
# =============================================================================
# Nateiva Sales Analytics — isolated, non-destructive deploy for the OVH VPS.
# Runs ON the VPS as root (via sudo), called by GitHub Actions.
#
#   sudo bash remote-deploy.sh <bundle_dir> <release_id>
#
# <bundle_dir> contains: release.tgz, env.conf, templates/
# Optional stdin: initial DB password (used only the very first time).
#
# Guarantees:
#   * Never overwrites the main Caddyfile / nginx.conf, other sites, services or DBs.
#   * Refuses to run if any of its own names already exist but were not created by it.
#   * Never drops/truncates data; backs up its own DB before every migration.
#   * Code lives in versioned releases; data lives outside them (MySQL + STATE_DIR).
#   * Rolls back app and proxy changes if health checks fail.
# =============================================================================
set -Eeuo pipefail

BUNDLE="${1:?bundle dir required}"
RELEASE_ID="${2:?release id required}"
# shellcheck source=../env.conf
source "$BUNDLE/env.conf"

MARKER_NAME=".managed-by-nateiva-sales-analytics-ci"
ENV_FILE="$ETC_DIR/api.env"
REL_DIR="$BASE_DIR/releases/$RELEASE_ID"
TS="$(date +%Y%m%d-%H%M%S)"
PROXY=""
PROXY_ROLLBACK=()          # commands that undo proxy changes
PREV_RELEASE=""

log()  { printf '[deploy %s] %s\n' "$(date +%T)" "$*"; }
# return (not exit) so the ERR trap fires and rolls back whatever was changed so far
die()  { printf '[deploy ERROR] %s\n' "$*" >&2; return 1; }
render() { # render <template> <dest>
  sed -e "s#__APP_DOMAIN__#$APP_DOMAIN#g" -e "s#__APP_PORT__#$APP_PORT#g" \
      -e "s#__LOG_DIR__#$LOG_DIR#g"       -e "s#__BASE_DIR__#$BASE_DIR#g" \
      -e "s#__ETC_DIR__#$ETC_DIR#g"       -e "s#__STATE_DIR__#$STATE_DIR#g" \
      -e "s#__RUN_USER__#$RUN_USER#g"     -e "s#__NODE_BIN__#${NODE_BIN:-}#g" \
      "$1" > "$2"
}
https_code() { # https_code <host> <path>  -> HTTP code via local proxy (000 = no answer)
  curl -s -o /dev/null -w '%{http_code}' -m 10 --resolve "$1:443:127.0.0.1" "https://$1$2" || true
}
port_code() { curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$1/" || true; }

rollback_proxy() {
  if [ "${#PROXY_ROLLBACK[@]}" -gt 0 ]; then
    log "Rolling back proxy changes"
    for cmd in "${PROXY_ROLLBACK[@]}"; do eval "$cmd" || true; done
    case "$PROXY" in
      caddy) systemctl reload caddy || true ;;
      nginx) nginx -t && systemctl reload nginx || true ;;
    esac
  fi
}
on_error() {
  local code=$?
  log "Deploy failed (exit $code) — restoring previous state"
  rollback_proxy
  if [ -n "$PREV_RELEASE" ] && [ -d "$PREV_RELEASE" ]; then
    ln -sfn "$PREV_RELEASE" "$BASE_DIR/current.tmp" && mv -Tf "$BASE_DIR/current.tmp" "$BASE_DIR/current"
    systemctl restart "$SERVICE" || true
    log "App rolled back to $PREV_RELEASE"
  fi
  exit "$code"
}
trap on_error ERR

[ "$(id -u)" -eq 0 ] || die "must run as root (sudo)"
INIT_DB_PASSWORD=""
if [ ! -t 0 ]; then INIT_DB_PASSWORD="$(cat || true)"; fi
if [ -n "$INIT_DB_PASSWORD" ] && ! [[ "$INIT_DB_PASSWORD" =~ ^[A-Za-z0-9_-]{16,}$ ]]; then
  die "initial DB password must be 16+ chars of letters, digits, _ or -"
fi

# -----------------------------------------------------------------------------
# 1. OWNERSHIP GUARD — never take over something that belongs to another project
# -----------------------------------------------------------------------------
FIRST_INSTALL=0
if [ -f "$ETC_DIR/$MARKER_NAME" ]; then
  log "Existing Nateiva Sales Analytics environment found (marker present)"
else
  FIRST_INSTALL=1
  log "No marker: first install — checking that every name is free"
  for p in "$BASE_DIR" "$STATE_DIR" "$ETC_DIR" "$LOG_DIR" \
           "/etc/systemd/system/$SERVICE.service" \
           "/etc/caddy/$APP_ID.caddy" "/etc/nginx/sites-available/$APP_ID.conf"; do
    [ ! -e "$p" ] || die "$p already exists but is not managed by this project — aborting, nothing changed"
  done
  ! id -u "$RUN_USER" >/dev/null 2>&1 || die "system user $RUN_USER already exists — aborting, nothing changed"
fi

# Port must be free, or held by OUR service only.
OUR_PID="$(systemctl show -p MainPID --value "$SERVICE" 2>/dev/null || echo 0)"
PORT_LINE="$(ss -ltnpH "sport = :$APP_PORT" 2>/dev/null || true)"
if [ -n "$PORT_LINE" ] && ! grep -q "pid=${OUR_PID}," <<<"$PORT_LINE"; then
  die "port $APP_PORT is used by another process: $PORT_LINE — aborting, nothing changed"
fi

# -----------------------------------------------------------------------------
# 2. DETECT the reverse proxy that already owns 80/443 (never install a second one)
# -----------------------------------------------------------------------------
WEB_LISTEN="$(ss -ltnpH '( sport = :443 or sport = :80 )' 2>/dev/null || true)"
if grep -q '"caddy"' <<<"$WEB_LISTEN"; then PROXY=caddy
elif grep -q '"nginx"' <<<"$WEB_LISTEN"; then PROXY=nginx
elif [ -z "$WEB_LISTEN" ]; then PROXY=caddy-install
else die "ports 80/443 are held by an unknown process ($WEB_LISTEN) — refusing to guess"
fi
log "Reverse proxy: $PROXY"

# Baseline of existing sites (re-checked at the end).
declare -A BEFORE_HOST BEFORE_PORT
for h in $PROTECTED_HOSTS; do BEFORE_HOST[$h]="$(https_code "$h" /)"; log "baseline https://$h -> ${BEFORE_HOST[$h]}"; done
for p in $PROTECTED_PORTS; do BEFORE_PORT[$p]="$(port_code "$p")"; log "baseline 127.0.0.1:$p -> ${BEFORE_PORT[$p]}"; done

# -----------------------------------------------------------------------------
# 3. RUNTIME: Node.js and MySQL/MariaDB — reuse if present, install only if absent
# -----------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  log "Node.js not found — installing Node 20 (no existing Node to conflict with)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  NODE_BIN="$(command -v node)"
fi
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 16 ] || die "Node $NODE_MAJOR is too old (need >= 16); not upgrading a shared runtime automatically"
NPM_BIN="$(dirname "$NODE_BIN")/npm"; [ -x "$NPM_BIN" ] || NPM_BIN="$(command -v npm)"
export NODE_BIN

if ! command -v mysql >/dev/null 2>&1; then
  log "No MySQL/MariaDB found — installing MariaDB"
  apt-get update -y && apt-get install -y mariadb-server
  systemctl enable --now mariadb
fi
mysql -e "SELECT 1" >/dev/null 2>&1 || die "cannot reach MySQL as root via socket; create DB '$DB_NAME' manually"

# -----------------------------------------------------------------------------
# 4. ISOLATED IDENTITY, FOLDERS, CONFIG (created once, never overwritten)
# -----------------------------------------------------------------------------
id -u "$RUN_USER" >/dev/null 2>&1 || useradd --system --home "$STATE_DIR" --shell /usr/sbin/nologin "$RUN_USER"
install -d -m 755 "$BASE_DIR" "$BASE_DIR/releases"
install -d -m 750 -o "$RUN_USER" -g "$RUN_USER" "$STATE_DIR" "$STATE_DIR/backups" "$LOG_DIR"
install -d -m 750 -o root -g "$RUN_USER" "$ETC_DIR"
[ -f "$ETC_DIR/$MARKER_NAME" ] || echo "created $TS by CI release $RELEASE_ID" > "$ETC_DIR/$MARKER_NAME"

DB_USER_EXISTS="$(mysql -N -e "SELECT COUNT(*) FROM mysql.user WHERE user='$DB_USER'")"
if [ ! -f "$ENV_FILE" ]; then
  [ "$DB_USER_EXISTS" = "0" ] || die "DB user $DB_USER exists but $ENV_FILE is missing — not resetting a password"
  DB_PW="${INIT_DB_PASSWORD:-$(openssl rand -hex 24)}"
  JWT="$(openssl rand -hex 48)"
  umask 027
  cat > "$ENV_FILE" <<EOF
PORT=$APP_PORT
HOST=127.0.0.1
NODE_ENV=production
NATEIVA_SALE_ANALYTIC_API_NAME=$SERVICE
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PW
JWT_SECRET=$JWT
ALLOWED_ORIGINS=https://meteilhip.github.io,https://nateiva-dashboard.vercel.app,https://$APP_DOMAIN
DEFAULT_CALL_COUNT=130
EOF
  chown root:"$RUN_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"
  log "Created $ENV_FILE (kept on future deploys)"
fi
# shellcheck disable=SC1090
DB_PW="$(set -a; . "$ENV_FILE"; printf '%s' "$DB_PASSWORD")"

# Dedicated database + user, scoped to this database only. IF NOT EXISTS = never destructive.
mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PW';
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PW';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

# -----------------------------------------------------------------------------
# 5. RELEASE (code only — no data inside the release folder)
# -----------------------------------------------------------------------------
PREV_RELEASE="$(readlink -f "$BASE_DIR/current" 2>/dev/null || true)"
rm -rf "$REL_DIR.partial"; mkdir -p "$REL_DIR.partial"
tar -xzf "$BUNDLE/release.tgz" -C "$REL_DIR.partial"
rm -f "$REL_DIR.partial/.env"
( cd "$REL_DIR.partial" && "$NPM_BIN" install --omit=dev --no-audit --no-fund --loglevel=error )
rm -rf "$REL_DIR"; mv "$REL_DIR.partial" "$REL_DIR"
chown -R root:"$RUN_USER" "$REL_DIR"; chmod -R g+rX,o-rwx "$REL_DIR"

# Backup this project's DB before migrating (only if it has tables).
TABLES="$(mysql -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB_NAME'")"
if [ "$TABLES" != "0" ]; then
  mysqldump --single-transaction --routines "$DB_NAME" | gzip > "$STATE_DIR/backups/pre-$RELEASE_ID-$TS.sql.gz"
  ls -1t "$STATE_DIR"/backups/pre-*.sql.gz | tail -n +31 | xargs -r rm -f   # keep 30
  log "DB backup saved in $STATE_DIR/backups"
fi
# Additive, idempotent migrations (CREATE TABLE IF NOT EXISTS / ADD COLUMN if missing).
runuser -u "$RUN_USER" -- bash -c "set -a; . '$ENV_FILE'; set +a; cd '$REL_DIR' && '$NODE_BIN' src/scripts/migrate.js"

# -----------------------------------------------------------------------------
# 6. SERVICE + atomic switch + local health check
# -----------------------------------------------------------------------------
render "$BUNDLE/templates/app.service" "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
ln -sfn "$REL_DIR" "$BASE_DIR/current.tmp" && mv -Tf "$BASE_DIR/current.tmp" "$BASE_DIR/current"
systemctl restart "$SERVICE"

ok=0
for _ in $(seq 1 30); do
  if curl -fsS -m 3 "http://127.0.0.1:$APP_PORT/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "$ok" = 1 ] || { journalctl -u "$SERVICE" -n 40 --no-pager || true; tail -n 40 "$LOG_DIR/api-error.log" 2>/dev/null || true; false; }
log "Local health OK: http://127.0.0.1:$APP_PORT/healthz"

# -----------------------------------------------------------------------------
# 7. REVERSE PROXY — dedicated include file only
# -----------------------------------------------------------------------------
case "$PROXY" in
  caddy-install)
    log "No web server on 80/443 — installing Caddy"
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy
    PROXY=caddy ;;
esac

if [ "$PROXY" = caddy ]; then
  CADDYFILE="$(systemctl cat caddy 2>/dev/null | grep -oP -- '--config\s+\K\S+' | head -1)"; CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
  INCLUDE="/etc/caddy/$APP_ID.caddy"
  [ -f "$INCLUDE" ] && cp -a "$INCLUDE" "$INCLUDE.bak.$TS" && PROXY_ROLLBACK+=("cp -a '$INCLUDE.bak.$TS' '$INCLUDE'") \
                    || PROXY_ROLLBACK+=("rm -f '$INCLUDE'")
  render "$BUNDLE/templates/caddy.caddy" "$INCLUDE"
  # Is our file already covered by an import in the main Caddyfile? (exact path or a glob)
  covered=0
  while read -r pat; do
    for f in $pat; do [ "$f" = "$INCLUDE" ] && covered=1; done
  done < <(grep -oP '^\s*import\s+\K\S+' "$CADDYFILE" 2>/dev/null || true)
  if [ "$covered" = 0 ]; then
    # Append ONE import line (backup first). The rest of the Caddyfile is untouched.
    cp -a "$CADDYFILE" "$CADDYFILE.bak.$TS"
    PROXY_ROLLBACK+=("cp -a '$CADDYFILE.bak.$TS' '$CADDYFILE'")
    printf '\n# Nateiva Sales Analytics (isolated include, added by CI %s)\nimport %s\n' "$TS" "$INCLUDE" >> "$CADDYFILE"
    log "Added one import line to $CADDYFILE (backup: $CADDYFILE.bak.$TS)"
  fi
  caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null || die "caddy validate failed"
  systemctl reload caddy
elif [ "$PROXY" = nginx ]; then
  SITE="/etc/nginx/sites-available/$APP_ID.conf"
  if [ -d /etc/nginx/sites-enabled ] && grep -rqs 'sites-enabled' /etc/nginx/nginx.conf; then LINK="/etc/nginx/sites-enabled/$APP_ID.conf"
  else LINK="/etc/nginx/conf.d/$APP_ID.conf"; fi
  if [ -f "$SITE" ]; then
    cp -a "$SITE" "$SITE.bak.$TS"; PROXY_ROLLBACK+=("cp -a '$SITE.bak.$TS' '$SITE'")
  else
    mkdir -p /etc/nginx/sites-available; render "$BUNDLE/templates/nginx.conf" "$SITE"
    PROXY_ROLLBACK+=("rm -f '$SITE' '$LINK'")
  fi
  [ -e "$LINK" ] || ln -s "$SITE" "$LINK"
  nginx -t || die "nginx -t failed"
  systemctl reload nginx
  if ! grep -q 'listen 443' "$SITE"; then
    command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx
    # Certificate for THIS host only; certbot edits only this server block.
    certbot --nginx -d "$APP_DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
    nginx -t && systemctl reload nginx
  fi
fi

# -----------------------------------------------------------------------------
# 8. VERIFY proxy route + existing sites, roll back proxy if anything regressed
# -----------------------------------------------------------------------------
code=000
for _ in $(seq 1 30); do   # allow time for certificate issuance
  code="$(https_code "$APP_DOMAIN" /healthz)"
  [ "$code" = 200 ] && break; sleep 4
done
[ "$code" = 200 ] || die "https://$APP_DOMAIN/healthz via reverse proxy returned $code"
log "Proxy route OK: https://$APP_DOMAIN/healthz"

regressed=0
for h in $PROTECTED_HOSTS; do
  now="$(https_code "$h" /)"; before="${BEFORE_HOST[$h]}"
  log "check https://$h: before=$before after=$now"
  if [ "$before" != 000 ] && [ "${before:0:1}" != 5 ] && { [ "$now" = 000 ] || [ "${now:0:1}" = 5 ]; }; then regressed=1; fi
done
for p in $PROTECTED_PORTS; do
  now="$(port_code "$p")"; before="${BEFORE_PORT[$p]}"
  log "check 127.0.0.1:$p: before=$before after=$now"
  if [ "$before" != 000 ] && [ "$now" = 000 ]; then regressed=1; fi
done
[ "$regressed" = 0 ] || die "an existing site regressed after the proxy change"

# Keep the 5 most recent releases.
ls -1dt "$BASE_DIR"/releases/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf
trap - ERR
log "DEPLOY OK — release $RELEASE_ID live at https://$APP_DOMAIN (first_install=$FIRST_INSTALL)"
