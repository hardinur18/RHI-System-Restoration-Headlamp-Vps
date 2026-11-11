// Exercise the real route with an in-memory KV boundary, never a provider or DB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const source = fs.readFileSync(process.env.META_CONFIG_TEST_SOURCE || 'supabase/functions/server/index.tsx', 'utf8');
const route = '/make-server-f781cd00/meta/integration-configs/:adAccountId';
const start = source.indexOf(`app.post("${route}"`);
const end = source.indexOf('\napp.post(', start + 1);
assert(start > 0 && end > start);
const { code } = transformSync(source.slice(start, end), { loader: 'tsx', target: 'es2022' });
const clone = value => JSON.parse(JSON.stringify(value));
const key = 'meta_integration_config:test-account';
const original = {
  adAccountId: 'test-account', enabled: true,
  liveMetaAccountId: 'act_123', liveMetaAccountName: 'Test Account',
  businessManagerId: '456', businessManagerName: 'Test Business',
};
let handler, permitted = true, readFailure = false, writes = 0;
const store = new Map([[key, clone(original)]]);
vm.runInNewContext(code, {
  app: { post: (path, fn) => { assert.equal(path, route); handler = fn; } },
  ADS_MANAGE_PERMISSION: 'ads.manage',
  requireAuthorizedRequester: async (_c, permissions) => {
    assert.deepEqual(Array.from(permissions), ['ads.manage']);
    return permitted ? { requester: { authUser: { id: 'test-owner' } } } : { response: { status: 403 } };
  },
  kv: {
    get: async k => { if (readFailure) throw new Error('DB unavailable'); return store.has(k) ? clone(store.get(k)) : null; },
    set: async (k, v) => { writes++; store.set(k, clone(v)); },
  },
  console: { error() {} },
});
const call = body => handler({
  req: { param: () => 'test-account', json: async () => body },
  json: (body, status = 200) => ({ body, status }),
});

// This reproduces the UI's actual toggle payload: no account metadata is sent.
for (const enabled of [false, true, true]) {
  const result = await call({ enabled });
  assert.equal(result.status, 200);
  for (const field of ['liveMetaAccountId', 'liveMetaAccountName', 'businessManagerId', 'businessManagerName']) {
    assert.equal(store.get(key)[field], original[field], `toggle must preserve ${field}`);
  }
  assert.equal(store.get(key).enabled, enabled);
  assert.equal(store.get(key).updatedBy, 'test-owner');
}
await call({ enabled: true, liveMetaAccountName: ' Renamed ' });
assert.equal(store.get(key).liveMetaAccountName, 'Renamed');
assert.equal(store.get(key).liveMetaAccountId, 'act_123');
await call({ enabled: true, liveMetaAccountId: ' act_789 ', liveMetaAccountName: 'Replacement' });
assert.equal(store.get(key).liveMetaAccountId, 'act_789');
await call({ enabled: false, liveMetaAccountId: '', liveMetaAccountName: null });
assert.equal(store.get(key).liveMetaAccountId, undefined);
assert.equal(store.get(key).liveMetaAccountName, undefined);

store.delete(key);
assert.equal((await call({ ...original })).status, 200);
assert.equal(store.get(key).liveMetaAccountId, original.liveMetaAccountId);
const unchanged = clone(store.get(key));
const writeCount = writes;
for (const body of [null, {}, { enabled: 'false' }]) assert.equal((await call(body)).status, 400);
permitted = false;
assert.equal((await call({ enabled: false })).status, 403);
permitted = true;
readFailure = true;
assert.equal((await call({ enabled: false })).status, 500);
assert.equal(writes, writeCount);
assert.deepEqual(store.get(key), unchanged);
console.log('PASS Meta mapping: OFF/ON, rename, replacement, explicit clear, new config, validation, access and DB failures');
