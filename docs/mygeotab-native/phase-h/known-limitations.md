# Known Limitations
- Workflows unverified on GitHub; the web-only install flag combination should be confirmed in a first run.
- `apps/api` is still a workspace, so a plain `npm install` still installs Hono etc. (legacy job and local dev).
- Old command names (`dev:api`, `db:migrate`) no longer exist.
- Historical docs (Phase 1–16 reports) still describe legacy and old-layer behaviour; only the three docs above are bannered.
- `geotab/opex-vbm-config.json` is unchanged (menu path/schema unverified for the tenant).
- Source maps are published.
