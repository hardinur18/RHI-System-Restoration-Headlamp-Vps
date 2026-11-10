import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

// Build with `npm run build -- --manifest`, then pass the output directory.
// Static dependency bytes are reproducible; they are not a page-load timing.
const directory = process.argv[2] || 'dist';
const manifest = JSON.parse(fs.readFileSync(path.join(directory, '.vite/manifest.json'), 'utf8'));
const check = process.argv.includes('--check');
function closure(key, found = new Set()) {
  assert.ok(manifest[key], `Missing manifest entry: ${key}`);
  if (found.has(key)) return found;
  found.add(key);
  for (const child of manifest[key].imports || []) closure(child, found);
  return found;
}
function resolveEntry(source) {
  return manifest[source] ? source : Object.keys(manifest).find((key) => manifest[key].name === path.basename(source, '.tsx'));
}
function measure(source) {
  const key = resolveEntry(source);
  if (!manifest[key]) return null;
  const keys = [...closure(key)];
  const files = [...new Set(keys.map((entry) => manifest[entry].file))];
  const buffers = files.map((file) => fs.readFileSync(path.join(directory, file)));
  return {
    chunks: files.length,
    bytes: buffers.reduce((total, buffer) => total + buffer.length, 0),
    gzipBytes: buffers.reduce((total, buffer) => total + gzipSync(buffer).length, 0),
    files,
  };
}
// Rollup uses a shared-chunk key when lazy modules also export shared context.
const workspace = 'src/app/AuthenticatedWorkspace.tsx';
const dashboard = 'src/app/pages/Dashboard.tsx';
const roles = ['technician/TechnicianDashboard', 'cs/CSDashboard', 'advertiser/AdvertiserDashboard']
  .map((name) => `src/app/pages/${name}.tsx`);
if (check) {
  const entryKeys = closure('index.html');
  const workspaceKey = resolveEntry(workspace);
  assert.ok(manifest[workspaceKey]?.isDynamicEntry, 'Workspace must have an independent lazy boundary');
  assert.ok(!entryKeys.has(workspaceKey), 'Login must not eagerly load the workspace');
  for (const role of roles) {
    const roleKey = resolveEntry(role);
    assert.ok(manifest[roleKey]?.isDynamicEntry, `Role must have an independent lazy boundary: ${role}`);
    assert.ok(!closure(resolveEntry(dashboard)).has(roleKey), `Dashboard selector eagerly loads ${role}`);
    for (const other of roles.filter((item) => item !== role)) {
      assert.ok(!closure(roleKey).has(resolveEntry(other)), `${role} eagerly loads another role`);
    }
  }
  const loginFiles = [...entryKeys].map((key) => manifest[key].file).join('\n');
  assert.ok(!/vendor-(charts|map|pdf|xlsx)/.test(loginFiles), 'Heavy features leaked into login');
  assert.ok(!/vendor-ui-(?!core-)/.test(loginFiles), 'Login eagerly loads the full UI widget group');
  const serviceWorker = fs.readFileSync(path.join(directory, 'sw.js'), 'utf8');
  for (const file of [...entryKeys].flatMap((key) => [manifest[key].file, ...(manifest[key].css || [])])) {
    assert.ok(serviceWorker.includes(file), `Initial asset missing from PWA precache: ${file}`);
  }
}
console.log(JSON.stringify({
  kind: 'static-javascript-dependency-bytes',
  checksPassed: check,
  login: measure('index.html'),
  workspace: measure(workspace),
  dashboardSelector: measure(dashboard),
  roles: Object.fromEntries(roles.map((role) => [path.basename(role), measure(role)])),
}, null, 2));
