# Phase H — Legacy Backend Isolation: Executive Summary

**Status: complete at code level. Legacy backend preserved, isolated and unreachable from the default workflow.** Git state unverifiable (ZIP baseline). No deployment, no migration, no cloud resource touched.

Done: the frontend no longer imports anything from `apps/api` (the one remaining type import moved into `apps/web/src/data/geotabTypes.ts`); root `dev`/`build`/`test`/`typecheck` run only the native Add-In; every legacy script is `legacy:`-prefixed; CI is split into a web-only job (installs only the web workspace) and a separate legacy job; the Pages workflow builds and publishes only static assets and no longer configures an API URL; README, `.env.example` and legacy docs updated or bannered; architecture tests lock all of this in.

Kept on purpose: `apps/api`, `db/migrations`, `scripts/migrate.mjs`, `wrangler.toml` and all historical docs (not deleted).
