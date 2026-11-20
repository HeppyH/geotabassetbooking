# Tests and Evidence
- `npm run typecheck`: clean. `npm test` (web): 296 pass / 0 fail (292 + 4 new Phase H architecture tests; the apps/api import test was rewritten to forbid all such imports).
- `npm run build`: succeeds; `dist` = `index.html`, `assets/`, `serviceAddin.js`.
- `npm run legacy:typecheck`: clean. `npm run legacy:test`: 65 pass / 0 fail (one test deliberately updated, see implementation details).
- `diff -rq` against the ZIP baseline: legacy source under `apps/api/src`, `db/`, `scripts/`, `wrangler.toml` unchanged; only `LEGACY.md` added and the one test edited under `apps/api`.
- Not run: CI workflows themselves (no GitHub Actions here), `npm install --workspace apps/web --include-workspace-root` against the registry. **The workflow YAML is untested until it runs on GitHub.**
