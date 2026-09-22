#!/usr/bin/env node
// Official Node.js 22 runtime matching the bundled native engine modules.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const version = '22.23.2';
const expected = '0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4';
const dest = fileURLToPath(new URL('../src-tauri/resources/node.exe', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (existsSync(dest) && hash(readFileSync(dest)) === expected) {
  console.log(`Verified Node ${version}: ${dest}`);
} else {
  const response = await fetch(`https://nodejs.org/dist/v${version}/win-x64/node.exe`);
  if (!response.ok) throw new Error(`Node download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== expected) throw new Error('Node SHA-256 mismatch');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(`${dest}.download`, bytes);
  renameSync(`${dest}.download`, dest);
  console.log(`Installed verified Node ${version}: ${dest}`);
}
