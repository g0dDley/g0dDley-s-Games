// Builds standalone double-click executables (Windows/Mac/Linux) for the
// solo-demo game server, using esbuild (ESM->CJS transpile, one module at a
// time so relative requires/paths stay intact) + @yao-pkg/pkg (bundles a
// Node runtime + the app into a single binary; embeds public/ as assets).
//
// Needs real internet access: pkg downloads a prebuilt Node binary per
// target (~50-100MB) from GitHub releases. Without that route it falls back
// to compiling Node/V8 from source, which takes far too long to be
// practical (confirmed in a network-restricted sandbox — killed after 20+
// minutes of V8 compilation). Run this on a normal dev machine.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, 'dist-pkg');
const outDir = path.join(root, 'dist');

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'game'), { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

// 1. Transpile the two server-side ESM sources to CJS, preserving the
//    original relative directory layout so `pkg`'s require-graph walk and
//    our path.join(__dirname, ...) calls both resolve the same as in dev.
for (const rel of ['server.js', 'game/core.js']) {
  const res = esbuild.transformSync(fs.readFileSync(path.join(root, rel), 'utf8'), {
    loader: 'js', format: 'cjs', platform: 'node', target: 'node18',
  });
  fs.writeFileSync(path.join(stage, rel), res.code);
}

// 2. Copy the browser client verbatim — served as raw bytes, never require()'d
//    server-side (except shared.js, which core.js's transpiled require() picks
//    up from this same copy).
fs.cpSync(path.join(root, 'public'), path.join(stage, 'public'), { recursive: true });

// 3. Minimal package.json for pkg + a real node_modules/ws (pure JS, safe to
//    bundle) so the require('ws') in the transpiled server.js resolves.
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
  name: 'zombies-from-mars', version: '1.0.0', main: 'server.js', bin: 'server.js',
  dependencies: { ws: '*' },
  pkg: { assets: ['public/**/*'], targets: [] },
}, null, 2));
fs.cpSync(path.join(root, 'node_modules', 'ws'), path.join(stage, 'node_modules', 'ws'), { recursive: true });

// 4. Package. One binary per platform; @yao-pkg/pkg fetches prebuilt Node
//    runtimes for cross-target builds, so this works even from Linux.
const targets = {
  'zombies-from-mars-windows.exe': 'node18-win-x64',
  'zombies-from-mars-mac-intel': 'node18-macos-x64',
  'zombies-from-mars-mac-applesilicon': 'node18-macos-arm64',
  'zombies-from-mars-linux': 'node18-linux-x64',
};
for (const [outName, target] of Object.entries(targets)) {
  console.log(`packaging ${outName} (${target})...`);
  execFileSync('npx', ['@yao-pkg/pkg', '.', '--target', target, '--output', path.join(outDir, outName)], {
    cwd: stage, stdio: 'inherit',
  });
}
console.log('done ->', outDir);
