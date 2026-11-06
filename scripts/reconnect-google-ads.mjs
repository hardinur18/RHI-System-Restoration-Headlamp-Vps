import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

// Receive an existing Google Ads grant locally and save it privately for review.
// Does not update Supabase Cloud, VPS credentials, or provider configuration.
const args = process.argv.slice(2);
const arg = name => args[args.indexOf(name) + 1];
for (const name of ['--secrets', '--email', '--output']) {
  if (!args.includes(name) || !arg(name) || arg(name).startsWith('--')) throw new Error('Missing ' + name);
}
const output = path.resolve(arg('--output'));
if (!output.includes(path.sep + '.migration-local' + path.sep)) throw new Error('Output must be private .migration-local');
if (fs.existsSync(output)) throw new Error('Refusing to overwrite an existing credential file');
const secrets = JSON.parse(fs.readFileSync(arg('--secrets'), 'utf8'));
const redirect = 'http://127.0.0.1:53682/oauth2callback';
const state = crypto.randomBytes(32).toString('base64url');
const verifier = crypto.randomBytes(48).toString('base64url');
const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
for (const [key, value] of Object.entries({
  client_id: secrets.GOOGLE_ADS_CLIENT_ID, redirect_uri: redirect, response_type: 'code',
  scope: 'https://www.googleapis.com/auth/adwords', access_type: 'offline', prompt: 'consent',
  state, login_hint: arg('--email'), code_challenge_method: 'S256',
  code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
})) authorize.searchParams.set(key, value);
const urlFile = output + '.authorization-url';
fs.writeFileSync(urlFile, authorize.href, { mode: 0o600 });
let used = false;
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  const url = new URL(req.url, redirect);
  if (req.method !== 'GET' || url.pathname !== '/oauth2callback') { res.writeHead(404); res.end('Not found'); return; }
  if (url.searchParams.get('state') !== state || used) { res.writeHead(400); res.end('State tidak valid atau sudah digunakan.'); return; }
  used = true;
  try {
    if (url.searchParams.has('error') || !url.searchParams.get('code')) throw new Error('Grant rejected');
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(20000), body: new URLSearchParams({
        client_id: secrets.GOOGLE_ADS_CLIENT_ID, client_secret: secrets.GOOGLE_ADS_CLIENT_SECRET,
        grant_type: 'authorization_code', code: url.searchParams.get('code'),
        redirect_uri: redirect, code_verifier: verifier,
      }),
    });
    const token = await response.json();
    if (!response.ok || !token.refresh_token) throw new Error('Token exchange rejected');
    fs.writeFileSync(output, JSON.stringify({ ...token, saved_at: new Date().toISOString(),
      requested_account: arg('--email') }, null, 2), { mode: 0o600, flag: 'wx' });
    console.log('Google Ads grant saved privately. Provider API access must still be verified.');
    res.end('Izin Google Ads tersimpan privat. Pengujian koneksi RHI dilanjutkan; aplikasi lama tidak diubah.');
  } catch {
    process.exitCode = 1;
    console.error('Google Ads authorization did not produce a usable refresh token. No credentials deployed.');
    res.writeHead(400); res.end('Otorisasi belum berhasil. Tidak ada perubahan kredensial pada aplikasi.');
  } finally { server.close(); clearTimeout(timeout); fs.rmSync(urlFile, { force: true }); }
});
const timeout = setTimeout(() => { console.error('Authorization timed out.'); server.close(); fs.rmSync(urlFile, { force: true }); }, 20 * 60 * 1000);
server.on('error', () => { console.error('OAuth callback port unavailable.'); clearTimeout(timeout); fs.rmSync(urlFile, { force: true }); process.exitCode = 1; });
server.listen(53682, '127.0.0.1', () => console.log('Google Ads callback ready on loopback. Open the private authorization URL in the browser.'));
