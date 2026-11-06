import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:18080';
const localOrigin = 'http://127.0.0.1:4173';
const marker = await (await fetch(base + '/__rhi/uat')).json();
assert.equal(marker.database, 'rhi_uat_20261106');
assert.equal(marker.provider_delivery, false);
const requestedHeaders = ['authorization', 'apikey', 'content-type', 'accept-profile', 'content-profile', 'x-client-info'];
for (const origin of [localOrigin, 'https://untrusted.example']) {
  for (const route of ['/auth/v1/token', '/rest/v1/orders', '/storage/v1/bucket']) {
    const response = await fetch(base + route, { method: 'OPTIONS', headers: {
      Origin: origin, 'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': requestedHeaders.join(', '),
    } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin === localOrigin ? localOrigin : null);
    const allowed = response.headers.get('access-control-allow-headers').toLowerCase().split(',').map(x => x.trim());
    for (const header of requestedHeaders) assert.ok(allowed.includes(header), header);
  }
}
// Actual responses also need CORS, not just successful preflight responses.
const actual = await fetch(base + '/auth/v1/settings', { headers: { Origin: localOrigin } });
assert.equal(actual.headers.get('access-control-allow-origin'), localOrigin);
console.log('PASS UAT CORS: Auth, REST, Storage preflight; unrelated origin denied; actual response covered');
