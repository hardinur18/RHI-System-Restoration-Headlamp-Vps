import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'rhi-pwa-'));
try {
  const modulePath = path.join(temporary, 'controller.mjs');
  await build({ entryPoints: ['src/app/services/pwaUpdateController.ts'], outfile: modulePath,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const { createPwaUpdateController } = await import(pathToFileURL(modulePath));
  let reloadA = 0, reloadB = 0, activations = 0, online = true, notifications = 0;
  const a = createPwaUpdateController(() => reloadA++, () => online);
  const b = createPwaUpdateController(() => reloadB++, () => online);
  const unsubscribe = a.subscribe(() => notifications++);
  a.setActivator(async () => { activations++; a.activated(); b.activated(); });
  a.available(); b.available();
  assert.equal(reloadA + reloadB, 0, 'Discovery must not reload either tab');
  online = false;
  await a.apply();
  assert.equal(activations, 0, 'Offline activation must be refused');
  assert.ok(a.getSnapshot().error);
  online = true;
  await a.apply();
  assert.equal(reloadA, 1);
  assert.equal(reloadB, 0, 'Other tab must preserve its unsaved form');
  assert.equal(b.getSnapshot().available, true);
  await b.apply();
  assert.equal(reloadB, 1, 'Other tab reloads only after its own consent');
  a.activated(); await a.apply();
  assert.equal(reloadA, 1, 'Repeated lifecycle events reload only once');
  unsubscribe();
  const count = notifications; a.available(); assert.equal(notifications, count);

  let failuresReloaded = 0;
  const fail = createPwaUpdateController(() => failuresReloaded++, () => true);
  fail.setActivator(async () => { throw new Error('unavailable'); });
  fail.available(); await fail.apply();
  assert.equal(fail.getSnapshot().applying, false);
  assert.ok(fail.getSnapshot().error);
  fail.activated();
  assert.equal(failuresReloaded, 0, 'Failure revokes pending consent');

  let lateReloaded = 0;
  const late = createPwaUpdateController(() => lateReloaded++, () => true, 5);
  late.setActivator(async () => {}); late.available(); await late.apply();
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(late.getSnapshot().applying, false);
  late.activated(); assert.equal(lateReloaded, 0, 'Late activation after timeout must not reload');
  await late.apply(); assert.equal(lateReloaded, 1);

  let staleReloaded = 0;
  const stale = createPwaUpdateController(() => staleReloaded++, () => true);
  stale.requestReload(); assert.equal(staleReloaded, 0);
  await stale.apply(); assert.equal(staleReloaded, 1);
  const config = await fs.readFile('vite.config.ts', 'utf8');
  assert.ok(config.includes("registerType: 'prompt'"));
  assert.ok(config.includes('skipWaiting: false'));
  assert.ok(config.includes('navigateFallbackDenylist'));
  console.log('PASS PWA: deferred discovery, offline refusal, per-tab consent, external activation, once-only reload, unsubscribe, activation failure, timeout, late activation, stale-chunk consent, prompt configuration');
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
