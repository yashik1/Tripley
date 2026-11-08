#!/usr/bin/env node
/**
 * Copies MapLibre's web worker into public/ so the website serves it at
 * /maplibre-gl-worker.mjs (Expo copies public/ into the web export).
 *
 * MapLibre 6 loads its worker from a file next to its own module, found via
 * import.meta.url. In a bundled app that points at the bundle, where no
 * worker exists, so the map couldn't draw tiles. TripMap.web.tsx sets the
 * worker URL to this copy instead. Runs on install and before web exports,
 * so the worker always matches the installed library version.
 */
const fs = require('fs');
const path = require('path');

let src;
try {
  src = require.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs');
} catch {
  // Not installed (e.g. a partial install); nothing to copy.
  process.exit(0);
}
const destDir = path.resolve(__dirname, '..', 'public');
const dest = path.join(destDir, 'maplibre-gl-worker.mjs');
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`Copied MapLibre worker to ${path.relative(process.cwd(), dest)}`);
