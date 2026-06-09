# Nateiva Sale Analytic API

Shared sync backend for the Nateiva dashboard.

This project is intentionally isolated from the existing Laravel apps already running on the VPS.

Core names to preserve:

- project folder: `nateiva-sale-analytic-api`
- database: `nateiva_sale_analytic_prod`
- database user: `nateiva_sale_analytic_app`
- service: `nateiva-sale-analytic-api.service`

## Responsibilities

- authenticate dashboard users
- store synchronized followups and new school entries
- keep permissions and pane access centralized
- import existing browser `localStorage` data after login
- expose a bootstrap payload so GitHub Pages and Vercel clients can refresh from one source of truth

## Endpoints

- `GET /health`
- `POST /api/auth/login`
- `GET /api/bootstrap`
- `POST /api/followups`
- `DELETE /api/followups/:id` (Noah only)
- `POST /api/users`
- `POST /api/users/access`
- `POST /api/sync/local-state`

## Local run

1. Copy `.env.example` to `.env`
2. Run `npm install`
3. Run `npm run migrate`
4. Run `npm run seed`
5. Run `npm start`

## VPS deployment

Use the files under `deploy/`:

- `deploy/systemd/nateiva-sale-analytic-api.service`
- `deploy/nginx/nateiva-sale-analytic-api.sslip.io.conf`

These are designed to avoid collisions with existing services on the VPS.
