import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// A dedicated SSH forward must bind this loopback port to the staging gateway.
const base = 'http://127.0.0.1:18000';
const env = Object.fromEntries(fs.readFileSync('.migration-local/target-supabase.env', 'utf8')
  .split('\n').filter(x => x.includes('=') && !x.startsWith('#')).map(x => {
    const index = x.indexOf('='); return [x.slice(0, index), x.slice(index + 1)];
  }));
const client = createClient(base, env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const id = crypto.randomUUID();
let channel;
let inserted = false;
let received;
let receiveTimeout;
const event = new Promise((resolve, reject) => {
  received = resolve;
  receiveTimeout = setTimeout(() => reject(new Error('Realtime event timed out')), 60_000);
});
// Handle a timeout even if subscription fails before event is awaited.
event.catch(() => {});
try {
  const health = await fetch(base + '/functions/v1/make-server-f781cd00/health', {
    headers: { apikey: env.ANON_KEY, Authorization: 'Bearer ' + env.ANON_KEY },
  });
  assert.equal(health.status, 200);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime subscription timed out')), 30_000);
    let channelReady = false;
    let postgresReady = false;
    const ready = () => {
      if (channelReady && postgresReady) { clearTimeout(timer); resolve(); }
    };
    channel = client.channel('rhi-migration-realtime-' + id)
      .on('system', {}, message => {
        if (message.extension === 'postgres_changes' && message.status === 'ok') {
          postgresReady = true; ready();
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: 'id=eq.' + id }, payload => received(payload))
      .subscribe(status => {
        if (status === 'SUBSCRIBED') { channelReady = true; ready(); }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error('Realtime ' + status)); }
      });
  });
  const result = await client.from('events').insert({ id, tenant_id: 'rhi-migration-fixture',
    type: 'migration.realtime.test', trace_id: id, source: 'migration-smoke', payload: { fixture: true } });
  if (result.error) throw new Error('Fixture insert failed: ' + result.error.code);
  inserted = true;
  const message = await event;
  assert.equal(message.new.id, id);
  assert.equal(message.eventType, 'INSERT');
  fs.writeFileSync('.migration-local/realtime-smoke.json', JSON.stringify({
    postgres_change_received: true, transport: 'WebSocket via SSH gateway tunnel',
  }, null, 2), { mode: 0o600 });
  console.log('PASS Realtime WebSocket subscription and PostgreSQL change delivery');
} finally {
  clearTimeout(receiveTimeout);
  if (channel) await client.removeChannel(channel);
  if (inserted) {
    const result = await client.from('events').delete().eq('id', id);
    assert.equal(result.error, null, 'Realtime fixture cleanup failed');
  }
}
