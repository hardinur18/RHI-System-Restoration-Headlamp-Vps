import fs from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';

// Read-only provider diagnostics. No messages, conversion events, ad mutations,
// webhook updates or token rotations. Only Google access-token refresh is POST.
const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
if (!args.includes('--secrets') || !args.includes('--kv') || !args.includes('--output')) {
  throw new Error('Usage: node scripts/audit-provider-readiness.mjs --secrets PRIVATE.json --kv PRIVATE.json --output PRIVATE.json');
}
const secrets = JSON.parse(fs.readFileSync(value('--secrets'), 'utf8'));
const kv = JSON.parse(fs.readFileSync(value('--kv'), 'utf8'));
const secret = key => String(secrets[key] || '').trim();
const checks = [];

function graphUrl(endpoint, token) {
  const url = new URL('https://graph.facebook.com/' + secret('META_GRAPH_VERSION') + endpoint);
  // Match the application: this app requires server-side appsecret_proof.
  url.searchParams.set('appsecret_proof', createHmac('sha256', secret('META_APP_SECRET')).update(token).digest('hex'));
  return url;
}

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json', 'User-Agent': 'RHI-Migration-Verification/1.0', ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}
async function check(name, action) {
  try { checks.push({ name, ...await action() }); }
  catch { checks.push({ name, state: 'unverified', reason: 'network_or_response_error' }); }
}
function outcome(response, body, count) {
  const providerError = body.error || (typeof body.code === 'number' && body.code !== 0);
  return { state: response.ok && !providerError ? 'passed' : 'blocked', http: response.status,
    ...(body.error?.code != null ? { provider_code: body.error.code } : {}),
    ...(typeof body.code === 'number' ? { provider_code: body.code } : {}),
    ...(Number.isInteger(count) ? { count } : {}),
  };
}

// Owner deferred Google Ads from the first VPS release on 7 November 2026.
if (args.includes('--include-google-ads')) await check('google_ads', async () => {
  const stored = kv.google_ads_oauth_refresh_token;
  const refresh = typeof stored === 'string' ? stored : stored?.refreshToken || secret('GOOGLE_ADS_REFRESH_TOKEN');
  if (!refresh) return { state: 'blocked', reason: 'missing_refresh_token' };
  const { response, body } = await request('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: secret('GOOGLE_ADS_CLIENT_ID'),
      client_secret: secret('GOOGLE_ADS_CLIENT_SECRET'), refresh_token: refresh }),
  });
  if (!response.ok || !body.access_token) return { state: 'blocked', http: response.status,
    reason: body.error === 'invalid_grant' ? 'reauthorization_required' : 'oauth_rejected' };
  const result = await request('https://googleads.googleapis.com/' + secret('GOOGLE_ADS_API_VERSION') + '/customers:listAccessibleCustomers', {
    headers: { Authorization: 'Bearer ' + body.access_token, 'developer-token': secret('GOOGLE_ADS_DEVELOPER_TOKEN') },
  });
  return outcome(result.response, result.body, result.body.resourceNames?.length);
});
else checks.push({ name: 'google_ads', state: 'excluded', reason: 'deferred_from_first_release_by_owner' });
if (args.includes('--include-cekat')) await check('cekat', async () => {
  const { response, body } = await request('https://server.cekat.ai/labels', {
    headers: { access_token: secret('CEKAT_ACCESS_TOKEN'), 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  return { ...outcome(response, body, body.data?.labels?.length),
    ...(body.message === 'Invalid token' ? { reason: 'valid_access_token_required' } : {}) };
});
else checks.push({ name: 'cekat', state: 'excluded', reason: 'no_longer_used_by_owner' });
await check('kirimdev_webhooks', async () => {
  const base = new URL(secret('KIRIMDEV_API_BASE_URL'));
  if (base.origin !== 'https://api.kirimdev.com') throw new Error('Unexpected provider host');
  const { response, body } = await request(base.href.replace(/\/$/, '') + '/webhook_subscriptions', {
    headers: { Authorization: 'Bearer ' + secret('KIRIMDEV_API_KEY') },
  });
  const subscriptions = (body.data || []).map(item => ({ status: item.status,
    consecutive_failures: item.consecutive_failures, disabled_reason: item.disabled_reason || null }));
  return { ...outcome(response, body, subscriptions.length), subscriptions,
    ...(response.ok && (!subscriptions.length || body.has_more) ? { state: 'unverified', reason: 'subscription_inventory_incomplete' } : {}),
    ...(subscriptions.some(item => item.status !== 'active') ? { state: 'blocked', reason: 'disabled_webhook_subscriptions' } : {}) };
});
await check('instagram', async () => {
  const token = kv['meta:instagram:token:rhi-system'];
  const { response, body } = await request('https://graph.instagram.com/me?fields=id,username', {
    headers: { Authorization: 'Bearer ' + (token?.accessToken || token?.token || secret('META_IG_ACCESS_TOKEN')) },
  });
  return outcome(response, body);
});
await check('meta_ads_accounts', async () => {
  const { response, body } = await request(graphUrl('/me/adaccounts?fields=id&limit=100', secret('META_ACCESS_TOKEN')), {
    headers: { Authorization: 'Bearer ' + secret('META_ACCESS_TOKEN') },
  });
  return outcome(response, body, body.data?.length);
});
await check('meta_messaging_pages', async () => {
  const { response, body } = await request(graphUrl('/me/accounts?fields=id&limit=100', secret('META_DM_USER_TOKEN')), {
    headers: { Authorization: 'Bearer ' + secret('META_DM_USER_TOKEN') },
  });
  return outcome(response, body, body.data?.length);
});
// Owner deferred TikTok Ads from the first VPS release on 7 November 2026.
if (args.includes('--include-tiktok')) await check('tiktok_advertisers', async () => {
  const token = kv.tiktok_ads_oauth_token;
  if (!token?.accessToken) return { state: 'blocked', reason: 'authorization_required' };
  const url = new URL('https://business-api.tiktok.com/open_api/' + (secret('TIKTOK_API_VERSION') || 'v1.3') + '/oauth2/advertiser/get/');
  url.searchParams.set('app_id', secret('TIKTOK_APP_ID'));
  url.searchParams.set('secret', secret('TIKTOK_APP_SECRET'));
  const { response, body } = await request(url, { headers: { 'Access-Token': token.accessToken } });
  return { ...outcome(response, body, body.data?.list?.length),
    ...(body.code === 40001 && String(body.message).includes('User is blocked')
      ? { reason: 'provider_account_blocked_contact_tiktok' } : {}) };
});
else checks.push({ name: 'tiktok_advertisers', state: 'excluded', reason: 'deferred_from_first_release_by_owner' });

const report = { checked_at: new Date().toISOString(), scope: 'read_only_provider_access',
  end_to_end_verified: false, provider_configuration_changed: false, source_data_changed: false,
  checks, not_exercised: ['outbound_messages', 'conversion_dispatch', 'live_webhook_delivery',
    'scheduled_sync', 'external_email_deferred_by_owner'],
};
const output = path.resolve(value('--output'));
if (!output.includes(path.sep + '.migration-local' + path.sep)) throw new Error('Save reports only in private .migration-local');
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
fs.chmodSync(output, 0o600);
for (const result of checks) console.log(result.name + ': ' + result.state + (result.reason ? ' (' + result.reason + ')' : ''));
console.log('End-to-end integration verified: false (read-only diagnostic).');
