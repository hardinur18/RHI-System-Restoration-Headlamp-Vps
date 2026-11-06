#!/usr/bin/env python3
"""Patch one function in the verified original ESZIP, retaining all dependencies.

Restricted to ESZIP2.3 without internal checksums, as emitted by the source
platform. The gateway still verifies SHA256 of the whole bundle. Official format:
https://github.com/denoland/eszip/blob/v0.106.0/src/v2.rs
Always validate output with the official ESZIP parser and the pinned runtime.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('original')
parser.add_argument('repository_source')
parser.add_argument('output')
args = parser.parse_args()
os.umask(0o077)
original = Path(args.original).read_bytes()
assert original[:16] == b'ESZIP2.3\x00\x00\x00\x04\x00\x00\x01\x00', 'Unsupported ESZIP format/checksum'
output = Path(args.output)
assert not output.exists(), 'Never overwrite an existing bundle'
read32 = lambda data, offset: struct.unpack_from('>I', data, offset)[0]
header_size = read32(original, 16)
original_header = original[20:20+header_size]
header = bytearray(original_header)
entries, offset = [], 0
while offset < len(header):
    size = read32(header, offset)
    name = bytes(header[offset+4:offset+4+size]).decode()
    offset += 4 + size
    kind = header[offset]
    offset += 1
    if kind == 0:
        entries.append((name, offset, read32(header, offset), read32(header, offset+4)))
        offset += 17
    elif kind == 1:
        offset += 4 + read32(header, offset)
    elif kind == 2:
        offset += 4
    else:
        raise AssertionError('Unknown ESZIP header entry')
assert offset == len(header)
npm_start = 20 + header_size
source_size_offset = npm_start + 4 + read32(original, npm_start)
source_start = source_size_offset + 4
source_size = read32(original, source_size_offset)
source = original[source_start:source_start+source_size]
module = 'source/supabase/functions/server/index.tsx'
entry = next(e for e in entries if e[0] == module)
_, header_offset, module_offset, module_size = entry
map_offset, map_length = read32(header, header_offset+8), read32(header, header_offset+12)
map_size_offset = source_start + source_size
map_start = map_size_offset + 4
map_size = read32(original, map_size_offset)
maps = original[map_start:map_start+map_size]
old_module = source[module_offset:module_offset+module_size]
assert hashlib.sha256(old_module).hexdigest() == '39cef8266f5315d9db8016f93394fae364eb103cfc93881e691369b32987ff16', 'Unexpected source release; review before patching'
old = old_module.decode()
repo = Path(args.repository_source).read_text()
start = 'async function insertEmbedLeadWithSchemaFallback'
end = 'async function listLeadRowsByComparablePhone'
replacement = repo[repo.index(start):repo.index(end, repo.index(start))]
replacement = replacement.replace('payload: Record<string, unknown>', 'payload')
new_module = (old[:old.index(start)] + replacement + old[old.index(end, old.index(start)):]).encode()
change = len(new_module) - module_size
for name, at, position, length in entries:
    if name == module:
        struct.pack_into('>I', header, at+4, len(new_module))
        struct.pack_into('>II', header, at+8, 0, 0)
    elif length and position > module_offset:
        struct.pack_into('>I', header, at, position+change)
    if name != module and map_length and read32(header, at+12) and read32(header, at+8) > map_offset:
        struct.pack_into('>I', header, at+8, read32(header, at+8)-map_length)
new_source = source[:module_offset] + new_module + source[module_offset+module_size:]
patched = (original[:20] + header + original[npm_start:source_size_offset]
    + struct.pack('>I', source_size+change) + new_source + struct.pack('>I', map_size-map_length)
    + maps[:map_offset] + maps[map_offset+map_length:] + original[map_start+map_size:])
new_maps = maps[:map_offset] + maps[map_offset+map_length:]
for name, at, position, length in entries:
    after_position, after_length = read32(header, at), read32(header, at+4)
    before = source[position:position+length]
    after = new_source[after_position:after_position+after_length]
    assert after == (new_module if name == module else before), 'Unexpected module change'
    before_map_at, before_map_len = read32(original_header, at+8), read32(original_header, at+12)
    after_map_at, after_map_len = read32(header, at+8), read32(header, at+12)
    assert new_maps[after_map_at:after_map_at+after_map_len] == (b'' if name == module else maps[before_map_at:before_map_at+before_map_len])
output.write_bytes(patched)
report = {'original_sha256': hashlib.sha256(original).hexdigest(), 'patched_sha256': hashlib.sha256(patched).hexdigest(),
    'changed_module': module, 'module_sha256': hashlib.sha256(new_module).hexdigest(),
    'module_count': len(entries), 'all_module_bytes_and_maps_verified': True, 'npm_snapshot_unchanged': True, 'changed_module_stale_sourcemap_removed': True, 'official_parser_verified': False}
output.with_suffix('.receipt.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report))
