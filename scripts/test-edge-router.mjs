import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const secret = 'fixture-secret-at-least-thirty-two-characters';
const bundle = new Uint8Array([1, 2, 3]);
const digest = crypto.createHash('sha256').update(bundle).digest('hex');
const records = [
  { slug: 'private-function', verify_jwt: true, sha256: digest },
  { slug: 'public-webhook', verify_jwt: false, sha256: digest },
  { slug: 'broken-bundle', verify_jwt: false, sha256: 'incorrect' },
];
let handler;
const workers = [];
const source = await transform(fs.readFileSync('deploy/edge-router.ts', 'utf8'), { loader: 'ts', target: 'es2022' });
async function load(mode) {
await vm.runInNewContext(`(async()=>{${source.code}})()`, {
  crypto: crypto.webcrypto, TextEncoder, TextDecoder, Uint8Array, Array, Object,
  JSON, Map, Date, Response, Request, URL, atob,
  console: { error() {} },
  Deno: {
    readTextFile: async () => JSON.stringify(records),
    readFile: async () => bundle,
    env: { get: key => key === 'JWT_SECRET' ? secret : key === 'RHI_DEPLOYMENT_MODE' ? mode : undefined,
      toObject: () => ({ JWT_SECRET: secret, ...(mode ? { RHI_DEPLOYMENT_MODE: mode } : {}) }) },
    serve: fn => { handler = fn; },
  },
  EdgeRuntime: {
    userWorkers: { create: async options => {
      workers.push(options);
      return { fetch: async () => Response.json({ ok: true }) };
    } },
    applySupabaseTag() {},
  },
});
}
await load();

function token(claims, signingSecret = secret, alg = 'HS256') {
  const body = [Buffer.from(JSON.stringify({ alg })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url')].join('.');
  return body + '.' + crypto.createHmac('sha256', signingSecret).update(body).digest('base64url');
}
const now = Date.now() / 1000;
const request = (slug, jwt, method = 'GET') => new Request('http://runtime/' + slug,
  { method, headers: jwt ? { Authorization: 'Bearer ' + jwt } : {} });
for (const jwt of [undefined, 'malformed', token({ exp: now - 1 }), token({ exp: now + 3600 }, 'wrong'),
  token({ exp: now + 3600 }, secret, 'none'), token({}), token({ exp: now + 3600, nbf: now + 30 })]) {
  assert.equal((await handler(request('private-function', jwt))).status, 401);
}
assert.equal(workers.length, 0, 'Unauthorized requests must never start a worker');
assert.equal((await handler(request('missing', token({ exp: now + 3600 })))).status, 404);
assert.equal((await handler(request('private-function', token({ exp: now + 3600 })))).status, 200);
assert.equal((await handler(request('public-webhook'))).status, 200);
assert.equal((await handler(request('private-function', undefined, 'OPTIONS'))).status, 200);
assert.equal((await handler(request('broken-bundle'))).status, 503);
assert.equal(workers.length, 3);
for (const worker of workers) {
  assert.deepEqual(Array.from(worker.permissions.allow_net), ['api-rhi.polesheadlamp.id:443', 'api-gw:8000']);
  assert.equal(worker.envVars.find(([key]) => key === 'SUPABASE_FUNCTION_SLUG')[1], worker.servicePath.split('/').at(-1));
}
console.log('PASS JWT validation, public webhook routing, bundle integrity, and staging network restrictions');
await load('production');
const before = workers.length;
assert.equal((await handler(request('private-function'))).status, 401);
assert.equal(workers.length, before, 'Production mode must retain gateway authentication');
assert.equal((await handler(request('private-function', token({ exp: now + 3600 })))).status, 200);
assert.deepEqual(Array.from(workers.at(-1).permissions.allow_net), []);
await assert.rejects(load('typo'), /Invalid deployment mode/);
console.log('PASS explicit production network mode, authentication retained, invalid mode rejected');
