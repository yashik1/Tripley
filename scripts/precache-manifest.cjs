#!/usr/bin/env node
/**
 * After `expo export`, list every file the web app may need and stamp a build
 * version into the service worker, so it saves them all on install. Screens
 * load their code on first visit; without this, opening a screen you haven't
 * visited yet while offline would fail.
 *
 *   node scripts/precache-manifest.cjs [dist]
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dist = path.resolve(process.argv[2] || 'dist');
const files = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (!entry.name.endsWith('.map')) files.push('/' + path.relative(dist, full).split(path.sep).join('/'));
  }
}
walk(path.join(dist, '_expo'));
walk(path.join(dist, 'assets'));
for (const f of ['/', '/manifest.json', '/maplibre-gl-worker.mjs', '/icons/icon-192.png', '/icons/icon-512.png', '/favicon.ico']) {
  if (f === '/' || fs.existsSync(path.join(dist, f))) files.push(f);
}
files.sort();

// The bundle file names carry content hashes, so hashing the list (plus the
// page) gives a version that changes whenever anything changes.
const indexHtml = fs.readFileSync(path.join(dist, 'index.html'));
const swSource = fs.readFileSync(path.join(dist, 'sw.js'));
const version = crypto
  .createHash('sha256')
  .update(files.join('\n'))
  .update(indexHtml)
  .update(swSource)
  .digest('hex')
  .slice(0, 12);

fs.writeFileSync(path.join(dist, 'precache.json'), JSON.stringify({ version, files }));
const swPath = path.join(dist, 'sw.js');
const sw = fs.readFileSync(swPath, 'utf8');
if (!sw.includes("const VERSION = 'dev';")) {
  console.error('sw.js has no VERSION placeholder');
  process.exit(1);
}
fs.writeFileSync(swPath, sw.replace("const VERSION = 'dev';", `const VERSION = '${version}';`));
console.log(`Service worker ${version}: ${files.length} files to keep for offline use`);
