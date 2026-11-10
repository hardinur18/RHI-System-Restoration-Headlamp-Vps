# Local loading refactor — 10 November 2026

The local app now separates login, the authenticated workspace, and the three
dashboard views. Reference data no longer reloads every time the user changes
menus. This change is local and does not activate the VPS cutover.

## Changes

- `AuthenticatedWorkspace` loads after authentication. Its providers stay mounted
  during navigation and reset when the signed-in user changes.
- Advertiser, CS, and Technician dashboards have separate lazy imports with a
  loading state. The existing permission checks and view selection remain intact.
- Basic login controls and shared icon helpers no longer pull in the full menu,
  drawer, and dialog dependency group. Login dependencies are checked against
  the generated PWA precache.
- `useReferenceDataBootstrap` owns reference-data loading. It waits for current
  user resolution, reloads on explicit Refresh or user/role changes, and cancels
  queued tasks on disposal. Changing menus does not restart it. Route-specific
  operational data, the scheduling roster, and realtime subscriptions retain
  their separate behavior.
- `npm run preview:uat` builds optimized assets and serves them at
  `http://127.0.0.1:4173/`. It uses the same isolated UAT marker and anon-key checks
  as `npm run dev:uat`; external provider delivery remains disabled. Stop the
  existing local server before switching commands. Preview must be rebuilt after
  source edits; `dev:uat` remains available for hot reload.
- ESLint excludes private migration artifacts. React test renderer 18.3.1 is a
  development dependency for testing the real bootstrap hook lifecycle.

## Measurements

Baseline: source commit `a717a98`, built with Vite's manifest. After: optimized
local UAT build. The figures sum the static JavaScript dependency graph for the
login entry, excluding CSS/images and deferred modules.

| Metric | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| JavaScript bytes | 995,191 | 552,352 | 44.5% |
| Sum of gzip-compressed JS bytes | 294,229 | 167,389 | 43.1% |

This is an asset-size improvement, not a claim that every API call or page is
44.5% faster. The gzip figure is a local compression estimate, not measured
network transfer. A native Chrome login observation on this Mac reported first
contentful paint at 1,292 ms with no network throttling; there is no matching
before timing, so it is not an end-to-end speed comparison.

## Verification

- Lint, all six Phase 4 TypeScript checks, and strict-core check passed.
- Production build and generated import-graph/PWA-precache assertions passed.
- Real React hook tests passed for pending profile, menu changes, explicit
  refresh/latest callback, role/user changes, unmount, and queued cancellation.
- Queue tests passed for concurrency, partial failure, empty queues, and aborts.
- Existing modular-workspace contracts (seven role fallbacks and 61 routes),
  13 core contracts, PWA update protections, and VPS boundary tests passed.
- Native Chrome displayed the optimized login at 360 × 740. A temporary UAT
  Owner session opened Advertiser dashboard with copied metrics, Orders,
  Add Order, service choices, and Schedule. The order form was cancelled without
  saving. On dashboard → Orders, telemetry recorded only `prospect_bookings`,
  `wa_templates`, and `technician_schedules` full fetches, not the reference-data
  batch. Hook tests cover explicit Refresh and scope changes independently.
- The one-use local session page was removed immediately after entry. The
  temporary UAT profile, Auth user, and sessions were removed after testing.
- Local build scan passed against known private runtime secrets (223 files).

Browser tests did not cover every role's authenticated session or physical
Android/iPhone installation. The three dashboard import boundaries were verified
from the compiled dependency graph. Source data APIs and heavy historical report
queries were not redesigned; initial historical dashboard data can still take
several seconds. Large Orders/Schedule components remain candidates for a
separate feature-by-feature refactor, rather than being declared fully modular.

## Reproduce

```sh
node scripts/test-reference-bootstrap.mjs
node scripts/test-bootstrap-queue.mjs
node scripts/test-modular-workspace.mjs
npm run preview:uat
# From another terminal after the build finishes:
node scripts/audit-loading-bundles.mjs .migration-local/local-preview --check
```

Private measurements are in `.migration-local/perf-before.json` and
`.migration-local/perf-local-preview.json`. No source application, public VPS
frontend, webhook, scheduler, or production database was switched. The existing
private cutover kit `cutover-a717a98f31bc` still contains the previous frontend;
these changes require a new candidate/kit before inclusion in a live cutover.
