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
