import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

await fs.mkdir('.tmp', { recursive: true });
const directory = await fs.mkdtemp(path.resolve('.tmp/reference-bootstrap-'));
try {
  const outfile = path.join(directory, 'test.mjs');
  await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'reference-bootstrap-test.tsx', loader: 'tsx', contents: `
      import assert from 'node:assert/strict';
      import React from 'react';
      import { create, act } from 'react-test-renderer';
      import { useReferenceDataBootstrap } from './src/app/pages/master-data/context/internal/useReferenceDataBootstrap';

      function Probe(props) { useReferenceDataBootstrap(props); return null; }
      let root;
      const requests = [];
      const loading = [];
      const options = (overrides = {}) => ({
        enabled: true, scope: 'user-1:Owner', refreshVersion: 0,
        onLoadingChange: value => loading.push(value),
        createTasks: () => [async () => { requests.push('master'); }],
        ...overrides,
      });
      await act(async () => { root = create(<Probe {...options({enabled:false})} />); });
      assert.equal(requests.length, 0, 'Wait for current-user resolution');
      await act(async () => { root.update(<Probe {...options()} />); });
      assert.equal(requests.length, 1);
      assert.deepEqual(loading, [true, false]);
      for (const activePath of ['/orders/', '/schedule/', '/dashboard/']) {
        await act(async () => { root.update(<Probe {...options()} activePath={activePath} />); });
      }
      assert.equal(requests.length, 1, 'Menu changes must not refetch reference data');
      await act(async () => { root.update(<Probe {...options({refreshVersion:1,
        createTasks: () => [async () => { requests.push('latest-refresh'); }],
      })} />); });
      assert.deepEqual(requests, ['master', 'latest-refresh'], 'Refresh must use the latest callback');
      await act(async () => { root.update(<Probe {...options({scope:'user-1:CS', refreshVersion:1})} />); });
      assert.equal(requests.length, 3, 'Role change must refetch');
      await act(async () => { root.update(<Probe {...options({scope:'user-2:CS', refreshVersion:1})} />); });
      assert.equal(requests.length, 4, 'User change must refetch');
      await act(async () => { root.unmount(); });

      let release;
      const pending = new Promise(resolve => { release = resolve; });
      let started = 0;
      let disposedSignal;
      const pendingLoading = [];
      await act(async () => { root = create(<Probe {...options({
        onLoadingChange: value => pendingLoading.push(value),
        createTasks: signal => {
          disposedSignal = signal;
          return Array.from({length:12}, () => async () => { started++; await pending; });
        },
      })} />); });
      const activeAtDisposal = started;
      assert.ok(activeAtDisposal > 0 && activeAtDisposal < 12);
      await act(async () => { root.unmount(); });
      assert.equal(disposedSignal.aborted, true);
      await act(async () => { release(); });
      assert.equal(started, activeAtDisposal, 'Disposed scope must not start queued tables');
      assert.deepEqual(pendingLoading, [true], 'Disposed scope must not overwrite current loading state');
      console.log('PASS reference bootstrap: pending profile, navigation, explicit refresh, latest callback, role/user isolation, disposal and queued cancellation');
    ` },
    outfile, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic',
    external: ['react', 'react-test-renderer'], logLevel: 'silent',
  });
  await import(pathToFileURL(outfile).href);
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
