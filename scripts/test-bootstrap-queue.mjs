import assert from 'node:assert/strict';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rhi-bootstrap-'));
try {
  const outfile = path.join(directory, 'queue.mjs');
  await build({
    entryPoints: ['src/app/pages/master-data/context/internal/masterDataCache.ts'],
    outfile, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  });
  const { runSettledWithConcurrency } = await import(pathToFileURL(outfile).href);
  let active = 0;
  let peak = 0;
  const completed = [];
  await runSettledWithConcurrency(Array.from({ length: 8 }, (_, index) => async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    completed.push(index);
    if (index === 1) throw new Error('One table unavailable');
  }), 3);
  assert.equal(peak, 3);
  assert.equal(completed.length, 8, 'Failure must not starve other tables');

  const controller = new AbortController();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const started = [];
  const run = runSettledWithConcurrency(Array.from({ length: 8 }, (_, index) => async () => {
    started.push(index);
    await pending;
  }), 2, controller.signal);
  assert.deepEqual(started, [0, 1]);
  controller.abort();
  release();
  await run;
  assert.deepEqual(started, [0, 1], 'Leaving a scope must stop queued requests');
  await runSettledWithConcurrency([async () => assert.fail('Pre-cancelled task ran')], 1, controller.signal);
  await runSettledWithConcurrency([], 3);
  console.log('PASS bootstrap queue: bounded concurrency, partial failure, cancellation, pre-cancellation, empty queue');
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
