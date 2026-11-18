# Nateiva Sale Analytic Backend Map

This file exists so future AI changes do not touch the wrong project.

## Backend project identity

- backend code folder: `nateiva-sale-analytic-api`
- systemd service name: `nateiva-sale-analytic-api.service`
- env file path: `/etc/nateiva-sale-analytic/nateiva-sale-analytic-api.env`
- logs: `/var/log/nateiva-sale-analytic/`
- MySQL database: `nateiva_sale_analytic_prod`
- MySQL app user: `nateiva_sale_analytic_app`

## Isolation rule

Do **not** edit or reuse these existing VPS projects for dashboard sync work:

- `/var/www/nateiva`
- `/var/www/nateivalearn-staging`
- `nateiva-api.service`
- databases `nateivalearn` and `nateivalearn_staging`

## Frontend clients expected to consume this backend

- GitHub Pages dashboard
- Vercel dashboard link

## Sync rule

When a dashboard user logs in, the browser should:

1. authenticate against the backend
2. upload any existing local `followups`, invited users, and access overrides
3. refresh the dashboard from backend bootstrap data

That keeps current browser-entered data from being lost during migration.

## Campagne 2027 (ajouté 2026-11-18)

- Frontend : `nateiva-2027.js` (pane « 🚀 2027 ») — GPS + télémétrie dans les métadonnées de notes, liste prioritaire, attribution exclusive, pilotage YoY + IA, score de confiance.
- Backend : table `school_claim_requests` (créée par `node src/scripts/migrate.js`), endpoints `/api/claims/requests` (GET/POST) et `/api/claims/requests/:id/decision` (POST, SuperAdmin), verrou serveur sur `POST /api/followups` (403 `SCHOOL_LOCKED`), bootstrap enrichi (`campaignClaims`, `claimRequests`, `campaign`).
- Env optionnels : `NATEIVA_CAMPAIGN_YEAR` (défaut 2027), `NATEIVA_CAMPAIGN_START` (défaut 2027-01-01T00:00:00).
- Déploiement VPS : `git pull` dans le dossier release → `node src/scripts/migrate.js` → `systemctl restart nateiva-sale-analytic-api.service` → vérifier `/health` local + route proxy. Le frontend fonctionne aussi AVANT le redéploiement backend (repli localStorage pour les demandes) ; seul le verrou côté serveur attend la mise à jour.
