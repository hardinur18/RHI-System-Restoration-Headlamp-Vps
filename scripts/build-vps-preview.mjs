import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Build an identifiable candidate. Production artifacts are kept separate and
// cannot be promoted by the read-only promoter. This never changes any server.
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--production')) throw new Error('Only --production is supported');
const production = args[0] === '--production';
const root = process.cwd();
if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) {
  throw new Error('Commit reviewed changes before building a release candidate.');
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const values = Object.fromEntries(fs.readFileSync('.migration-local/target-supabase.env', 'utf8')
  .split('\n').filter(line => line.includes('=') && !line.startsWith('#')).map(line => {
    const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];
  }));
const anon = values.ANON_KEY;
const claims = JSON.parse(Buffer.from(anon.split('.')[1], 'base64url').toString());
if (claims.role !== 'anon' || claims.exp < Date.now() / 1000 + 86400) throw new Error('Invalid target anon key');
const directory = path.join(root, '.migration-local', production ? 'production-candidates' : 'preview-candidates', commit.slice(0, 12));
if (fs.existsSync(directory)) throw new Error('Candidate already exists; do not overwrite an audited release.');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITE_') && key !== 'RHI_LOCAL_UAT'));
Object.assign(env, {
  VITE_SUPABASE_URL: 'https://api-rhi.polesheadlamp.id', VITE_SUPABASE_PROJECT_ID: 'rhi-vps',
  VITE_SUPABASE_ANON_KEY: anon, VITE_FUNCTIONS_BASE_URL: 'https://api-rhi.polesheadlamp.id/functions/v1/make-server-f781cd00',
  VITE_AUTH_MODE: 'supabase', VITE_RHI_READ_ONLY: production ? 'false' : 'true', VITE_RHI_UAT: 'false',
  VITE_RHI_SNAPSHOT_LABEL: production ? '' : '6 November 2026, 19:33 WIB', VITE_META_DIRECT_FALLBACK: 'false', VITE_META_ACCESS_TOKEN: '',
});
// Disable dotenv loading: this artifact must never inherit Cloud or UAT settings.
env.RHI_PREVIEW_OUTPUT = directory;
execFileSync(process.execPath, ['--input-type=module', '--eval',
  "import { build } from 'vite'; await build({ envDir: false, build: { outDir: process.env.RHI_PREVIEW_OUTPUT } });"],
{ env, stdio: 'inherit' });
// Replace the obsolete source deployment marker with this candidate's manifest.
fs.rmSync(path.join(directory, 'release.json'), { force: true });
const files = fs.readdirSync(directory, { recursive: true }).filter(name => fs.statSync(path.join(directory, name)).isFile());
const runtime = JSON.parse(fs.readFileSync('.migration-local/live-runtime-secrets.json', 'utf8'));
const secretValues = Object.entries({ ...runtime, ...values }).filter(([key, value]) =>
  /SECRET|PASSWORD|TOKEN|API_KEY|SERVICE_ROLE/.test(key) && !/ANON/.test(key)
  && typeof value === 'string' && value.length > 16 && !value.startsWith('http'))
  .map(([, value]) => value);
for (const name of files) {
  const data = fs.readFileSync(path.join(directory, name));
  if (secretValues.some(value => data.includes(Buffer.from(value)))) throw new Error('Private value found in build: ' + name);
}
const manifest = { commit, read_only: !production, snapshot_label: production ? null : env.VITE_RHI_SNAPSHOT_LABEL,
  ...(production ? { purpose: 'cutover-candidate-not-deployed' } : {}),
  built_at: new Date().toISOString(), files: Object.fromEntries(files.map(name => [name,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')])) };
fs.writeFileSync(path.join(directory, 'release.json'), JSON.stringify(manifest, null, 2));
console.log('Verified ' + (production ? 'production candidate (not deployed)' : 'read-only candidate') + ': ' + directory);
