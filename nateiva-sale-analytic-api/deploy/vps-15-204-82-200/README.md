# Isolated environment — OVH VPS `vps-6964d2a4` (15.204.82.200)

This folder deploys the Sales Analytics API as a **new, separate environment** on the shared VPS.
It does not modify, reuse or replace any other project on that server, and it does not touch
the current backend on the old server (57.129.133.115), which keeps running until Vercel is switched.

## Dedicated names (nothing shared)

| Item | Value |
|---|---|
| Code (versioned releases) | `/opt/nateiva-sales-analytics/releases/<sha>` + `current` symlink |
| Data / backups (outside git releases) | MySQL DB `nateiva_sales_analytics_prod`, backups in `/var/lib/nateiva-sales-analytics/backups` |
| Config (created once, never overwritten) | `/etc/nateiva-sales-analytics/api.env` |
| Logs | `/var/log/nateiva-sales-analytics/` |
| systemd service | `nateiva-sales-analytics-api.service` |
| Linux user | `nateiva-sales` |
| DB user (rights on its own DB only) | `nateiva_sales_analytics_app` |
| Port (loopback only) | `127.0.0.1:4320` |
| Public domain (dedicated TLS cert) | `https://nateiva-sales-analytics.15-204-82-200.sslip.io` |
| Proxy file | `/etc/caddy/nateiva-sales-analytics.caddy` **or** `/etc/nginx/sites-available/nateiva-sales-analytics.conf` |

## Safety rules enforced by `scripts/remote-deploy.sh`

1. **Ownership guard**: on first install it aborts with no changes if any of the names above already exist
   (folder, service, Linux user, proxy file, DB user) or if port 4320 is taken.
2. **Proxy**: uses whichever web server already owns ports 80/443 (Caddy or nginx), never installs a second one.
   It writes only its own include/site file. With Caddy, if the main Caddyfile does not already import that file,
   the script appends **one** `import` line (after a timestamped backup) and runs `caddy validate` before reloading.
3. **Existing sites**: records the response of `nateivanemt-15-204-82-200.sslip.io` and ports 5300 and 5101 before the change,
   checks them again afterwards, and restores the proxy config if any of them got worse.
4. **Data**: migrations are additive only (`CREATE TABLE IF NOT EXISTS`, add a column if it's missing). A DB backup is taken before each migration.
   The data import refuses to run if the new DB already has any row.
5. **Self-healing**: the deploy succeeds only if `http://127.0.0.1:4320/healthz` returns 200 (it also checks the DB) **and**
   `https://<domain>/healthz` returns 200 through the reverse proxy. If either fails, the app goes back to the previous release
   and the proxy files are restored.

## One-time setup (GitHub → Settings → Secrets and variables → Actions)

| Secret | Purpose |
|---|---|
| `SA_VPS_SSH_KEY` | Private SSH key for `ubuntu@15.204.82.200` (user needs passwordless sudo) |
| `SA_OLD_SSH_KEY` | Private SSH key for `ubuntu@57.129.133.115`, used only for the one-time data copy |
| `SA_DB_PASSWORD` | Optional. 16+ letters, digits, `_` or `-`. If empty, a random one is generated on the VPS |
| `SA_VPS_KNOWN_HOSTS` | Optional. Pinned host key (otherwise the workflow trusts the key on first connection) |

Optional variables: `SA_VPS_USER`, `SA_OLD_USER` (default `ubuntu`).

## Cut-over order

1. Merge → workflow deploys the empty environment and checks it.
2. Ask the team to stop entering data for ~10 minutes, then run the workflow manually with **migrate_data = true**. The row counts from the old and new DB must match.
3. Change `vercel.json` `/napi` destination to `https://nateiva-sales-analytics.15-204-82-200.sslip.io/:path*`, deploy, then run the workflow with **check_vercel = true**.
4. Leave the old server running for a few days as a fallback.
