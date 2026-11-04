import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';

const root = process.cwd();
const productionRepo = 'hardinur18/app-polesheadlamp.id';
const migrationRepo = 'hardinur18/RHI-System-Restoration-Headlamp-Vps';

function condition(file, job) {
  const yaml = fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8');
  const block = yaml.split(`\n  ${job}:\n`)[1]?.split(/\n  [\w-]+:\n/)[0];
  assert.ok(block, `Missing job ${file}/${job}`);
  const match = block.match(/\n    if: ([^\n]+)(?:\n((?:      [^\n]*\n?)*))?/);
  assert.ok(match, `Missing job guard ${file}/${job}`);
  return match[1].trim() === '|' ? match[2].trim() : match[1];
}

const jobs = [
  ['pages-delivery.yml', 'deploy_preview'],
  ['pages-delivery.yml', 'deploy_production'],
  ['supabase-functions-delivery.yml', 'deploy_production'],
  ['supabase-migrations-delivery.yml', 'deploy_production'],
  ['google-ads-snapshot-refresh.yml', 'sync_incremental'],
  ['meta-ig-refresh.yml', 'refresh_instagram_token'],
];
for (const [file, job] of jobs) {
  const expression = condition(file, job);
  for (const event_name of ['push', 'workflow_dispatch', 'schedule', 'pull_request']) {
    for (const ref_name of ['main', 'development', 'chore/vps-isolated-migration']) {
      const github = { repository: migrationRepo, event_name, ref_name,
        event: { action: 'closed', pull_request: { merged: true, base: { ref: 'main' } } } };
      assert.equal(vm.runInNewContext(expression, { github }), false,
        `${file}/${job} can mutate production from ${migrationRepo}`);
    }
  }
  const github = { repository: productionRepo, event_name: 'push',
    ref_name: job === 'deploy_preview' ? 'development' : 'main', event: {} };
  assert.equal(vm.runInNewContext(expression, { github }), true,
    `${file}/${job} unexpectedly changes the original repository's behavior`);
}
console.log('PASS inherited deployment and scheduler guards across 12 event/branch contexts');

async function loadMaps(env) {
  const output = await build({
    entryPoints: ['src/utils/mapUtils.ts'], bundle: true, write: false,
    format: 'esm', platform: 'node', define: { 'import.meta.env': JSON.stringify(env) },
    plugins: [{ name: 'migration-test-aliases', setup(bundle) {
      bundle.onResolve({ filter: /^@\/lib\/supabaseClient$/ }, () => ({ path: 'session', namespace: 'fixture' }));
      bundle.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents:
        'export const supabase = {auth:{getSession:async()=>({data:{session:globalThis.__vpsTestSession}})}};' }));
      bundle.onResolve({ filter: /^@\// }, args => ({ path: path.join(root, 'src', args.path.slice(2) + '.ts') }));
      bundle.onResolve({ filter: /^\/utils\// }, args => ({ path: path.join(root, args.path.slice(1) + '.tsx') }));
    } }],
  });
  return import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
}

const originalFetch = globalThis.fetch;
const originalSession = globalThis.__vpsTestSession;
try {
  const scenarios = [
    [{ VITE_SUPABASE_URL: 'https://api-rhi.polesheadlamp.id' }, 'https://api-rhi.polesheadlamp.id/functions/v1/make-server-f781cd00/expand-url'],
    [{ VITE_FUNCTIONS_BASE_URL: ' https://custom.example.test/functions/// ' }, 'https://custom.example.test/functions/expand-url'],
    [{ VITE_SUPABASE_PROJECT_ID: 'cloud-fixture' }, 'https://cloud-fixture.supabase.co/functions/v1/make-server-f781cd00/expand-url'],
  ];
  for (const [env, expected] of scenarios) {
    const maps = await loadMaps({ ...env, VITE_SUPABASE_ANON_KEY: 'test-public-key' });
    const requests = [];
    globalThis.__vpsTestSession = { access_token: 'test-session-token' };
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init });
      return Response.json({ expandedUrl: 'https://maps.example.test/expanded' });
    };
    assert.equal(await maps.expandShortUrl('https://maps.app.goo.gl/example'), 'https://maps.example.test/expanded');
    assert.equal(requests[0].url, expected);
    assert.equal(requests[0].init.headers.Authorization, 'Bearer test-session-token');
    assert.deepEqual(JSON.parse(requests[0].init.body), { url: 'https://maps.app.goo.gl/example' });
    globalThis.__vpsTestSession = null;
    assert.equal(await maps.expandShortUrl('original'), 'original');
    assert.equal(requests.length, 1, 'Signed-out users must not trigger backend requests');
    globalThis.__vpsTestSession = { access_token: 'test-session-token' };
    globalThis.fetch = async () => new Response('', { status: 503 });
    assert.equal(await maps.expandShortUrl('original'), 'original');
  }
  const unconfigured = await loadMaps({});
  globalThis.fetch = async () => { throw new Error('Unconfigured app must not fetch'); };
  assert.equal(await unconfigured.expandShortUrl('original'), 'original');
  console.log('PASS map links use the configured VPS or cloud endpoint; auth and failure fallback preserved');
} finally {
  globalThis.fetch = originalFetch;
  if (originalSession === undefined) delete globalThis.__vpsTestSession;
  else globalThis.__vpsTestSession = originalSession;
}
