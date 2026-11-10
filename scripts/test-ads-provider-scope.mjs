// Exercise the actual server function with provider calls replaced by spies.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const source = fs.readFileSync('supabase/functions/server/index.tsx', 'utf8');
const start = source.indexOf('async function executeAdsDailySync');
const end = source.indexOf('async function sha256Hex', start);
assert(start > 0 && end > start);
const { code } = transformSync(source.slice(start, end), { loader: 'ts', target: 'es2022' });
const params = { runId: 'scope-test', range: { from: '2026-11-01', to: '2026-11-02' },
  filters: { branchId: 'fixture-branch' }, forceProviders: true };

async function run(scope, failing = []) {
  const called = [], materialized = [];
  const provider = key => async args => {
    called.push({ key, args });
    if (failing.includes(key)) throw new Error(`${key} unavailable`);
    return { rows: [{ platform: key, spend: 123 }] };
  };
  const context = vm.createContext({
    Deno: { env: { get: key => { assert.equal(key, 'RHI_ADS_SYNC_PROVIDERS'); return scope; } } },
    syncMetaSnapshotRange: provider('meta'), syncGoogleAdsSnapshotRange: provider('google'),
    syncTikTokSnapshotRange: provider('tiktok'), runAdsProviderWithRetry: op => op(),
    ADS_SYNC_PROVIDER_LABELS: { meta: 'Meta', google: 'Google', tiktok: 'TikTok' },
    materializeAdsSnapshotsToDailyAds: async args => { materialized.push(args); return { inserted: args.rows.length }; },
  });
  vm.runInContext(code, context);
  try { return { called, materialized, result: await context.executeAdsDailySync(params) }; }
  catch (error) { return { called, materialized, error }; }
}

const meta = await run('meta');
assert.deepEqual(meta.called.map(row => row.key), ['meta']);
assert.equal(meta.result.counts.inserted, 1);
assert.equal(meta.materialized[0].filters, params.filters);
assert.equal(meta.materialized[0].runId, params.runId);
assert.equal(meta.called[0].args.force, true);
assert.equal(meta.called[0].args.from, params.range.from);
assert.equal(meta.called[0].args.mappedOnly, true);
assert.deepEqual(Array.from(meta.result.providerStatuses, row => row.key), ['meta']);

assert.deepEqual((await run(undefined)).called.map(row => row.key), ['meta', 'google', 'tiktok']);
assert.deepEqual((await run(' meta, meta ')).called.map(row => row.key), ['meta']);
assert.deepEqual((await run('google')).called.map(row => row.key), ['google']);
for (const invalid of ['', ' ', 'meta,unknown', 'META']) {
  const result = await run(invalid);
  assert(result.error, 'Invalid explicit scope must fail closed');
  assert.equal(result.called.length, 0);
  assert.equal(result.materialized.length, 0);
}
const failed = await run('meta', ['meta']);
assert(failed.error);
assert.equal(failed.error.providerStatuses[0].state, 'error');
assert.equal(failed.materialized.length, 0);
const partial = await run(undefined, ['google']);
assert.equal(partial.result.errors.length, 1);
assert.equal(partial.result.counts.inserted, 2);
console.log('PASS provider scope: Meta only, default compatibility, filters, invalid configuration, failure reporting');
