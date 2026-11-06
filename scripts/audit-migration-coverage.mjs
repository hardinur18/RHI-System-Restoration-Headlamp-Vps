import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { transform } from 'esbuild';

const root = process.cwd();
const privateRoot = path.join(root, '.migration-local');
const baseline = path.join(privateRoot, 'frontend-baseline');
const sourceArchive = path.join(privateRoot, 'source-functions');
for (const required of [path.join(baseline, 'src/app/App.tsx'),
  path.join(sourceArchive, 'supabase/functions/server/index.tsx')]) {
  if (!fs.existsSync(required)) throw new Error('Missing private migration baseline: ' + required);
}
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const normalized = file => fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
function compare(base, areas) {
  const result = { matched: 0, missing: [], changed: [] };
  for (const file of areas.flatMap(area => walk(path.join(base, area)))) {
    const relative = path.relative(base, file);
    const target = path.join(root, relative);
    if (!fs.existsSync(target)) result.missing.push(relative);
    else if (!fs.readFileSync(file).equals(fs.readFileSync(target))) result.changed.push(relative);
    else result.matched++;
  }
  return result;
}
async function moduleFrom(file) {
  const { code } = await transform(normalized(file), { loader: 'ts', format: 'esm' });
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const routes = await moduleFrom('src/app/routing/appRouteRegistry.ts');
const originalRoutes = await moduleFrom(path.join(baseline, 'src/app/routing/appRouteRegistry.ts'));
const permissions = await moduleFrom('src/app/data/permissions.ts');
const keys = new Set(permissions.PERMISSIONS.map(item => item.key));
const router = normalized('src/app/routes.ts');
const layout = normalized('src/app/components/layout/AppLayout.tsx');
const mounts = [...router.matchAll(/authenticatedRoutes\("([^"]+)"\)/g)].map(match => match[1]);
const caseTabs = new Set([...layout.matchAll(/case ['"]([^'"]+)['"]:/g)].map(match => match[1]));
const workspaceMeta = ['src/app/pages/ads/adsMonitoringWorkspace.ts',
  'src/app/pages/conversations/conversationWorkspace.ts', 'src/app/pages/whatsapp/whatsappWorkspace.ts']
  .map(normalized).join('\n');
const placeholders = routes.APP_ROUTE_DEFINITIONS.filter(route => route.tabId && !caseTabs.has(route.tabId)
  && workspaceMeta.includes("'" + route.tabId + "'")).map(route => route.tabId);
const routeRows = routes.APP_ROUTE_DEFINITIONS.map(route => ({
  id: route.id, path: route.path, title: route.title,
  canonical_path: routes.getCanonicalAppPath(route), permission: route.permission || null,
  router_mounted: route.access === 'public' || mounts.some(mount => mount === '*' || (mount.endsWith('/*')
    ? route.path === mount.slice(0, -2) || route.path.startsWith(mount.slice(0, -1)) : mount === route.path)),
  permission_defined: !route.permission || keys.has(route.permission),
  layout_tab_referenced: !route.tabId || placeholders.includes(route.tabId) || layout.includes("'" + route.tabId + "'") || layout.includes('"' + route.tabId + '"'),
  placeholder_only: placeholders.includes(route.tabId),
}));
const originalIds = originalRoutes.APP_ROUTE_DEFINITIONS.map(route => route.id);
const missingRoutes = originalIds.filter(id => !routeRows.some(route => route.id === id));
const missingImports = [];
const syntaxFailures = [];
for (const file of walk(path.join(root, 'supabase/functions')).filter(file => /\.(ts|tsx)$/.test(file))) {
  const text = normalized(file);
  // These Deno modules contain TypeScript (including <T> arrows), no JSX.
  try { await transform(text, { loader: 'ts', format: 'esm' }); }
  catch { syntaxFailures.push(path.relative(root, file)); }
  for (const match of text.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)) {
    const target = path.resolve(path.dirname(file), match[1]);
    if (!['', '.ts', '.tsx', '/index.ts'].some(ext => fs.existsSync(target + ext))) {
      missingImports.push({ file: path.relative(root, file), import: match[1] });
    }
  }
}
const manifest = JSON.parse(fs.readFileSync(path.join(privateRoot, 'function-bundles-manifest.json'), 'utf8'));
const sourceFunctions = JSON.parse(fs.readFileSync(path.join(privateRoot, 'source-functions-20261106.json'), 'utf8'));
const functions = sourceFunctions.map(item => ({ slug: item.slug, version: item.version,
  bundle_present: manifest.some(bundle => bundle.slug === item.slug && bundle.version === item.version && bundle.verify_jwt === item.verify_jwt),
  source_entrypoint_present: fs.existsSync(path.join(root, 'supabase/functions', item.slug, 'index.ts')),
  required: !item.slug.startsWith('cekat-'),
}));
const report = { checked_at: new Date().toISOString(),
  source_frontend_commit: '5f406e0dff49a1c09f3a7c19b26fdf57c947da30',
  frontend_files: compare(baseline, ['src', 'utils', 'public']),
  archived_backend_files: compare(sourceArchive, ['supabase/functions']),
  routes: routeRows, missing_routes: missingRoutes, functions, missing_imports: missingImports,
  syntax_failures: syntaxFailures, runtime_rebuilt_from_repository: false,
  note: 'Static inventory only. Archived source variants are not interchangeable; VPS retains per-function immutable bundles.',
};
report.static_inventory_passed = !report.frontend_files.missing.length && !report.archived_backend_files.missing.length
  && !missingRoutes.length && !missingImports.length && !syntaxFailures.length
  && functions.every(item => item.bundle_present && item.source_entrypoint_present)
  && routeRows.every(item => item.router_mounted && item.permission_defined && item.layout_tab_referenced);
fs.writeFileSync(path.join(privateRoot, 'feature-coverage-inventory.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ static_inventory_passed: report.static_inventory_passed,
  route_definitions: routeRows.length, canonical_pages: new Set(routeRows.map(row => row.canonical_path)).size,
  frontend_missing: report.frontend_files.missing, backend_missing: report.archived_backend_files.missing,
  functions: functions.length, missing_imports: missingImports, syntax_failures: syntaxFailures,
  route_issues: routeRows.filter(row => !row.router_mounted || !row.permission_defined || !row.layout_tab_referenced),
  inventory_sha256: crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex') }, null, 2));
if (!report.static_inventory_passed) process.exitCode = 1;
