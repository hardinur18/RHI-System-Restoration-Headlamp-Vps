// Package already-tested artifacts privately. This does not publish or activate them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

assert.equal(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'Commit reviewed changes first');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const privateRoot = '.migration-local';
const frontend = path.join(privateRoot, 'production-candidates', commit.slice(0, 12));
const release = JSON.parse(fs.readFileSync(path.join(frontend, 'release.json')));
assert.equal(release.commit, commit);
assert.equal(release.read_only, false);
assert.equal(release.purpose, 'cutover-candidate-not-deployed');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for (const [file, hash] of Object.entries(release.files)) {
  assert(path.resolve(frontend, file).startsWith(path.resolve(frontend) + path.sep));
  assert.equal(sha(path.join(frontend, file)), hash);
}
const bundle = path.join(privateRoot, 'make-server-f781cd00-scoped.eszip');
const receipt = JSON.parse(fs.readFileSync(bundle.replace('.eszip', '.receipt.json')));
const uat = JSON.parse(fs.readFileSync(path.join(privateRoot, 'scoped-bundle-verification.json')));
assert(receipt.official_parser_verified && receipt.all_module_bytes_and_maps_verified);
assert(uat.passed && uat.baseline_restored && !uat.public_preview_changed);
assert.equal(sha(bundle), receipt.patched_sha256);
assert.equal(uat.candidate_sha256, receipt.patched_sha256);
const output = path.join(privateRoot, 'cutover-' + commit.slice(0, 12));
assert(!fs.existsSync(output), 'Never overwrite an audited kit');
fs.mkdirSync(output, { mode: 0o700 });
fs.cpSync(frontend, path.join(output, 'frontend'), { recursive: true });
const files = [
  [bundle, 'make-server-f781cd00.eszip'],
  [bundle.replace('.eszip', '.receipt.json'), 'bundle.receipt.json'],
  [path.join(privateRoot, 'scoped-bundle-verification.json'), 'uat.receipt.json'],
  ...['edge-router.ts', 'compose.staging.yml', 'compose.production.yml', 'prepare-vps-schedulers.py',
    'verify-cutover-kit.py'].map(name => ['deploy/' + name, name]),
  ['docs/cutover-readiness-2026-11-10.md', 'READINESS.md'],
];
for (const [source, name] of files) fs.copyFileSync(source, path.join(output, name));
const inventory = fs.readdirSync(output, { recursive: true }).filter(name => fs.statSync(path.join(output, name)).isFile());
const manifest = { commit, prepared_at: new Date().toISOString(), status: 'staged-only-not-authorized-for-cutover',
  predecessor_bundle_sha256: receipt.original_sha256, candidate_bundle_sha256: receipt.patched_sha256,
  required_gates: ['authorized_live_whatsapp_test', 'physical_phone_acceptance', 'source_writer_pause_window',
    'fresh_final_database_and_storage_parity', 'fresh_source_function_and_scheduler_drift_check'],
  files: Object.fromEntries(inventory.map(name => [name, sha(path.join(output, name))])) };
fs.writeFileSync(path.join(output, 'kit.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
console.log('Prepared private cutover kit: ' + output);
