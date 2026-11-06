import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
const text = fs.readFileSync('supabase/functions/server/index.tsx', 'utf8');
const start = text.indexOf('async function insertEmbedLeadWithSchemaFallback');
const end = text.indexOf('async function listLeadRowsByComparablePhone', start);
const { code } = await transform(text.slice(start, end), { loader: 'ts' });
const payload = { id: 'fixture', name: 'Fixture', phone: '000', origin: 'affiliate_public_booking', affiliate_id: 'affiliate-fixture', user_agent: 'fixture', referrer_url: 'https://example.invalid/' };
const missing = column => ({ code: 'PGRST204', message: `Could not find the '${column}' column of 'leads' in the schema cache` });
async function scenario(errors) {
  const writes = [];
  const context = { assertNoBlockingLeadDuplicate: async () => {}, supabase: { from(table) {
    assert.equal(table, 'leads');
    return { insert(row) { writes.push({ ...row }); return { select() { return { async single() {
      const error = errors.shift(); return { error, data: error ? null : row };
    } }; } }; } };
  } } };
  vm.createContext(context);
  vm.runInContext(code, context);
  let result, error;
  try { result = await context.insertEmbedLeadWithSchemaFallback(payload); } catch (e) { error = e; }
  return { result, error, writes };
}
const result = await scenario([missing('referrer_url'), missing('user_agent')]);
assert.equal(result.writes.length, 3);
assert.equal(result.result.origin, payload.origin);
assert.equal(result.result.affiliate_id, payload.affiliate_id);
assert.equal(result.result.user_agent, undefined);
assert.equal(payload.user_agent, 'fixture', 'Caller input is immutable');
for (const error of [missing('origin'), missing('affiliate_id'), missing('not_in_payload'), { code: '23505', message: 'duplicate' }, { code: '42501', message: 'permission denied' }]) {
  const tested = await scenario([error]);
  assert.equal(tested.error, error);
  assert.equal(tested.writes.length, 1, 'Unrelated failures must not cause lossy retries');
}
console.log('PASS optional-column fallback preserves attribution and rejects unsafe retries');
