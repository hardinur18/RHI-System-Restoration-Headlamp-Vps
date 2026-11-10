// Usage: node scripts/verify-eszip-patch.mjs original.bundle candidate.eszip /absolute/path/to/@deno/eszip/esm/mod.js
// Use the pinned official @deno/eszip 0.106.0 parser in a private tooling directory.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const [original, candidate, parserModule] = process.argv.slice(2);
assert(original && candidate && parserModule, 'Provide original, candidate and official parser module paths');
const { Parser } = await import(pathToFileURL(path.resolve(parserModule)).href);
const a = await Parser.createInstance(), b = await Parser.createInstance();
const names = await a.parseBytes(fs.readFileSync(original));
assert.deepEqual(await b.parseBytes(fs.readFileSync(candidate)), names);
await a.load(); await b.load();
// Opaque npm assets are not UTF-8; patch-lead-bundle.py verifies all of their
// raw bytes. The official parser is used for structure and application source.
const changed = [], changedMaps = [];
for (const name of names.filter(n => n.startsWith('source/'))) {
  if (await a.getModuleSource(name) !== await b.getModuleSource(name)) changed.push(name);
  if (await a.getModuleSourceMap(name) !== await b.getModuleSourceMap(name)) changedMaps.push(name);
}
assert.deepEqual(changed, ['source/supabase/functions/server/index.tsx']);
// A second scoped patch may start from an already-patched module whose stale
// source map was removed by the first patch.
assert(changedMaps.length === 0 || JSON.stringify(changedMaps) === JSON.stringify(changed));
const receiptPath = candidate.replace(/\.[^.]+$/, '.receipt.json');
const receipt = JSON.parse(fs.readFileSync(receiptPath));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(digest(original), receipt.original_sha256);
assert.equal(digest(candidate), receipt.patched_sha256);
assert(receipt.all_module_bytes_and_maps_verified);
receipt.official_parser_verified = true;
receipt.specifiers_verified = names.length;
fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
console.log('PASS official ESZIP parser and candidate source verification');
