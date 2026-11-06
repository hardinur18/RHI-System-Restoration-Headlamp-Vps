import { spawn, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';

// Frontend source runs on this Mac. Auth/DB/Storage use only the disposable
// UAT stack through SSH. Never download the service-role key into the browser.
const root = fileURLToPath(new URL('..', import.meta.url));
const ssh = ['-i', path.join(homedir(), '.ssh/polesheadlamp_vps_ed25519'),
  '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
  '-o', 'ServerAliveInterval=30', '-o', 'ExitOnForwardFailure=yes'];
const host = 'root@187.124.141.159';
const backend = 'http://127.0.0.1:18080';
const frontend = 'http://127.0.0.1:4173';
let tunnel;
let vite;
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  vite?.kill('SIGTERM');
  tunnel?.kill('SIGTERM');
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

function listening(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

async function main() {
  if (await listening(4173)) throw new Error('Port 4173 sedang dipakai. Hentikan server RHI lokal lama terlebih dahulu.');
  // Read only the public anon key, after asserting the exact isolated DB.
  const command = "python3 -c 'import json; from pathlib import Path; p=Path(\"/opt/rhi/uat-20261106\"); s=json.loads((p/\"preparation.json\").read_text()); assert s[\"database\"]==\"rhi_uat_20261106\" and s[\"containers_created\"]; print(json.loads((p/\"keys.json\").read_text())[\"ANON_KEY\"])'";
  const anon = execFileSync('ssh', [...ssh, host, command], { encoding: 'utf8', timeout: 25000 }).trim();
  const claims = JSON.parse(Buffer.from(anon.split('.')[1], 'base64url').toString());
  if (claims.role !== 'anon' || claims.exp < Date.now() / 1000 + 3600) {
    throw new Error('Kunci publik UAT tidak valid atau hampir kedaluwarsa. Perbarui UAT lebih dulu.');
  }
  if (!await listening(18080)) {
    tunnel = spawn('ssh', [...ssh, '-N', '-L', '127.0.0.1:18080:127.0.0.1:18080', host], { stdio: ['ignore', 'ignore', 'inherit'] });
    tunnel.on('error', () => stop(1));
    tunnel.on('exit', () => { if (!stopping) { console.error('Koneksi SSH UAT terputus.'); stop(1); } });
    for (let attempt = 0; attempt < 40 && !await listening(18080); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  const response = await fetch(backend + '/__rhi/uat', { signal: AbortSignal.timeout(5000) });
  const marker = await response.json();
  if (!response.ok || marker.environment !== 'rhi-isolated-uat' || marker.database !== 'rhi_uat_20261106' || marker.provider_delivery !== false) {
    throw new Error('Backend bukan UAT terisolasi yang diharapkan. Server lokal tidak dijalankan.');
  }
  // Also verify the key actually belongs to this gateway, not another SSH forward.
  const auth = await fetch(backend + '/auth/v1/settings', {
    headers: { apikey: anon, Authorization: 'Bearer ' + anon }, signal: AbortSignal.timeout(5000),
  });
  if (!auth.ok) throw new Error('Auth UAT tidak siap.');
  console.log('RHI lokal: ' + frontend + ' — salinan data uji; pengiriman provider belum diaktifkan.');
  vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--mode', 'uat'], {
    cwd: root, stdio: 'inherit', env: { ...process.env,
      RHI_LOCAL_UAT: 'true', VITE_AUTH_MODE: 'supabase', VITE_RHI_READ_ONLY: 'false', VITE_RHI_UAT: 'true',
      // Keep Auth's actual issuer. Rewriting it to the Vite origin causes the
      // application's strict cross-project session check to reject valid logins.
      VITE_SUPABASE_URL: backend, VITE_SUPABASE_PROJECT_ID: 'rhi-isolated-uat', VITE_SUPABASE_ANON_KEY: anon,
      VITE_FUNCTIONS_BASE_URL: frontend + '/functions/v1/make-server-f781cd00',
      VITE_META_DIRECT_FALLBACK: 'false', VITE_META_ACCESS_TOKEN: '',
    },
  });
  vite.on('error', () => stop(1));
  vite.on('exit', code => stop(code ?? 1));
}
main().catch(error => { console.error(error.message); stop(1); });
