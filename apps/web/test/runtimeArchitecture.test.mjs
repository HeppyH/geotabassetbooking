/* Phase B — static architecture checks over the real source tree (no mocks). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const read = (p) => fs.readFileSync(p, "utf8");
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function resolveImport(from, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return base;
}

/** Value imports only (import type / export type are ignored). Includes dynamic import(). */
function valueImports(file) {
  const text = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[2]) continue;
    out.push(m[4] ?? m[5] ?? m[6]);
  }
  return out;
}

function graph(entry) {
  const seen = new Set();
  const external = new Set();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/\.(ts|tsx)$/.test(f)) continue;
    for (const spec of valueImports(f)) {
      const r = resolveImport(f, spec);
      if (r === null) external.add(spec);
      else stack.push(r);
    }
  }
  return { files: [...seen].map((f) => path.relative(src, f).replace(/\\/g, "/")), external: [...external] };
}

const native = graph(path.join(src, "main.tsx"));
const sim = graph(path.join(src, "simulationMain.tsx"));
const has = (g, frag) => g.files.filter((f) => f.includes(frag));

test("native production graph excludes simulation and local/mock providers", () => {
  for (const frag of ["simulation/", "simulationMain", "data/dataProvider", "data/mockMyGeotab", "data/mygeotabProvider"]) {
    assert.deepEqual(has(native, frag), [], frag);
  }
});

test("simulation graph excludes every native module", () => {
  for (const frag of ["runtime/nativeRuntime", "runtime/nativeProvider", "runtime/gatedApi", "runtime/NativeHost", "data/addinDataProvider", "config/lifecycleBridge", "serviceAddin", "main.tsx"]) {
    assert.deepEqual(has(sim, frag), [], frag);
  }
});

test("simulation graph contains no MyGeotab API or network use", () => {
  for (const f of sim.files) {
    if (!/\.(ts|tsx)$/.test(f)) continue;
    const t = code(path.join(src, f));
    for (const bad of [/window\.geotab/, /self\.geotab/, /typeName:\s*["']AddInData["']/, /\bfetch\(/, /XMLHttpRequest/, /new WebSocket/, /\bapi\.call\(/]) {
      assert.equal(bad.test(t), false, `${f} matches ${bad}`);
    }
  }
});

test("no backend/database/HTTP-client packages are imported by either graph", () => {
  const banned = /^(hono|pg|postgres|wrangler|axios|node-fetch|undici|drizzle|@neondatabase|@hono)/;
  for (const g of [native, sim]) for (const e of g.external) assert.equal(banned.test(e), false, e);
  for (const g of [native, sim]) for (const f of g.files) {
    if (!/\.(ts|tsx)$/.test(f)) continue;
    assert.equal(/\bfetch\(|XMLHttpRequest|workers\.dev|:8787/.test(read(path.join(src, f))) && !f.startsWith("config/lifecycleDiagnostics"), false, f);
  }
});

test("the web app has no imports from the legacy apps/api package (type-only included)", () => {
  const offenders = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return walk(p);
    if (/\.(ts|tsx)$/.test(e.name) && /apps\/api|(\.\.\/){2,}api\//.test(read(p))) offenders.push(path.relative(src, p).replace(/\\/g, "/"));
  });
  walk(src);
  assert.deepEqual(offenders, []);
  assert.match(read(path.join(src, "data/types.ts")), /from "\.\/geotabTypes"/);
});

test("native graph does not use browser storage except the documented service exception", () => {
  for (const f of native.files) {
    if (!/\.(ts|tsx)$/.test(f)) continue;
    // Documented exception: serviceAddin.ts only touches Geotab's service-side `service.localStorage`
    // (not the browser). To be revisited in Phase F.
    if (f === "serviceAddin.ts") continue;
    const t = code(path.join(src, f));
    assert.equal(/\b(localStorage|sessionStorage|indexedDB)\b/.test(t), false, `${f} uses browser storage`);
  }
});

test("service add-in capability mirror cannot drift from the central config", async () => {
  const svc = await import("../src/serviceAddin.ts");
  const { PRODUCTION_CAPABILITY_CONFIG, CAPABILITY_NAMES } = await import("../src/runtime/capabilities.ts");
  assert.deepEqual(Object.keys(svc.SERVICE_CAPABILITIES).sort(), Object.keys(svc.SERVICE_CAPABILITIES).sort());
  for (const k of Object.keys(svc.SERVICE_CAPABILITIES)) {
    assert.ok(CAPABILITY_NAMES.includes(k), `${k} is not a central capability`);
    assert.equal(svc.SERVICE_CAPABILITIES[k], PRODUCTION_CAPABILITY_CONFIG[k], k);
    assert.equal(svc.SERVICE_CAPABILITIES[k], false);
  }
  assert.equal(svc.SERVICE_APPROVED_TENANT_DATABASES.length, 0);
  assert.equal(svc.isServiceDeliveryEnabled(svc.SERVICE_CAPABILITIES), false);
});

test("production UI exposes no live-mode override, AddInId editor or storage", () => {
  const app = code(path.join(src, "ui/App.tsx"));
  for (const bad of [/<select[^>]*value=\{mode\}/i, /setMode\(/, /localStorage/, /ADDIN_ID_STORAGE_KEY/, /onSaveAddInId/, /addInIdInput/, /createAddInDataProvider/, /bookingDataProvider/, /lifecycleBridge/, /getStateResetOnModeSwitch/, /canPerformLiveWrite/]) {
    assert.equal(bad.test(app), false, String(bad));
  }
  assert.match(app, /runtime:\s*AppRuntime/);
});

test("entry points and build config are separated", () => {
  assert.match(read(path.join(root, "index.html")), /src\/main\.tsx/);
  assert.match(read(path.join(root, "simulation.html")), /src\/simulationMain\.tsx/);
  const vite = read(path.join(root, "vite.config.ts"));
  assert.match(vite, /OPEX_INCLUDE_SIMULATION\s*===\s*"1"/);
  assert.match(vite, /:\s*\{\s*index:\s*"index\.html"\s*\}/);
  assert.match(read(path.join(src, "main.tsx")), /NativeHost/);
  assert.equal(/\bApp\b/.test(valueImports(path.join(src, "main.tsx")).join(" ")), false);
});

test("web package depends only on react and react-dom", () => {
  const pkg = JSON.parse(read(path.join(root, "package.json")));
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}).sort(), ["react", "react-dom"]);
});

test("storage engine modules use no browser storage, network client or MyGeotab globals", () => {
  const dir = path.join(src, "storage");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length >= 3);
  for (const f of files) {
    const t = code(path.join(dir, f));
    for (const bad of [/\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/, /\bfetch\(/, /XMLHttpRequest/, /window\.geotab/, /\bgetSession\b/]) {
      assert.equal(bad.test(t), false, `${f} matches ${bad}`);
    }
  }
});

test("domain modules (booking, authz, masterdata, admin, reports, notifications) are pure: no storage, network or MyGeotab globals", () => {
  for (const d of ["booking", "authz", "masterdata", "admin", "reports", "notifications"]) {
    const dir = path.join(src, d);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const t = code(path.join(dir, f));
      for (const bad of [/\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/, /\bfetch\(/, /XMLHttpRequest/, /window\.geotab/, /\bapi\.call\b/, /new WebSocket/]) {
        assert.equal(bad.test(t), false, `${d}/${f} matches ${bad}`);
      }
    }
  }
});

const repoRoot = path.resolve(root, "..", "..");

test("default root scripts run the native add-in only; legacy scripts are prefixed", () => {
  const pkg = JSON.parse(read(path.join(repoRoot, "package.json")));
  for (const name of ["dev", "build", "test", "typecheck"]) {
    assert.ok(pkg.scripts[name], name);
    assert.equal(/apps\/api|migrate|wrangler/.test(pkg.scripts[name]), false, `${name} must not touch the legacy backend`);
  }
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    if (/apps\/api|migrate|wrangler/.test(cmd)) assert.match(name, /^legacy:/, `${name} touches legacy code and must be prefixed`);
  }
  assert.equal("db:migrate" in pkg.scripts, false);
  assert.equal("dev:api" in pkg.scripts, false);
});

test("CI default job and Pages workflow carry no backend, database or API-URL configuration", () => {
  const ci = read(path.join(repoRoot, ".github/workflows/ci.yml"));
  const nativeJob = ci.slice(ci.indexOf("native-addin:"), ci.indexOf("legacy-backend:"));
  assert.ok(nativeJob.length > 50);
  for (const bad of [/apps\/api/, /legacy:/, /DATABASE_URL/, /wrangler/i, /hyperdrive/i, /neon/i, /workers\.dev/]) assert.equal(bad.test(nativeJob), false, `native job matches ${bad}`);
  assert.match(nativeJob, /--workspace apps\/web/);
  assert.match(ci.slice(ci.indexOf("legacy-backend:")), /legacy:test/);
  const pages = read(path.join(repoRoot, ".github/workflows/deploy-pages.yml"));
  for (const bad of [/VITE_API_BASE_URL/, /workers\.dev/, /DATABASE_URL/, /wrangler/i, /apps\/api/, /migrate/]) assert.equal(bad.test(pages), false, `pages workflow matches ${bad}`);
  assert.match(pages, /path: apps\/web\/dist/);
});

test("frontend source and build config reference no external API base URL", () => {
  for (const f of ["vite.config.ts", ".env.example", "index.html"]) assert.equal(/VITE_API_BASE_URL|workers\.dev|8787/.test(read(path.join(root, f))), false, f);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return walk(p);
    if (/\.(ts|tsx)$/.test(e.name)) assert.equal(/VITE_API_BASE_URL|workers\.dev|:8787/.test(code(p)), false, p);
  });
  walk(src);
});

test("legacy backend is preserved and marked, and the native README states the architecture", () => {
  assert.ok(fs.existsSync(path.join(repoRoot, "apps/api/LEGACY.md")));
  assert.ok(fs.existsSync(path.join(repoRoot, "apps/api/wrangler.toml")), "legacy backend must not be deleted in this phase");
  assert.ok(fs.existsSync(path.join(repoRoot, "db/migrations")));
  const readme = read(path.join(repoRoot, "README.md"));
  assert.match(readme, /no external application database/i);
  assert.match(readme, /AddInData/);
});
