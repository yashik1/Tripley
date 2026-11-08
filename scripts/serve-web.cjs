#!/usr/bin/env node
/**
 * Serves the exported web app (dist/) for hosting on Railway or any Node host.
 * - Unknown paths fall back to index.html (client-side routing, e.g. /join/<code>)
 * - /.well-known/* (iOS universal links, Android app links) served as JSON
 * - Fingerprinted assets under /_expo/static and /assets get long cache headers
 *
 *   node scripts/serve-web.cjs [dir=dist]      (listens on $PORT, default 8081)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || 'dist');
const port = Number(process.env.PORT || 8081);
const index = path.join(root, 'index.html');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

if (!fs.existsSync(index)) {
  console.error(`No ${index}. Run "npx expo export --platform web" first.`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    let file = path.join(root, path.normalize(urlPath));
    if (!file.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let isFile = false;
    try {
      isFile = fs.statSync(file).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) file = index;

    const headers = {
      'Content-Type': urlPath.startsWith('/.well-known/') ? 'application/json' : TYPES[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control':
        file !== index && (urlPath.startsWith('/_expo/static/') || urlPath.startsWith('/assets/'))
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
});

// Listen on IPv6 + IPv4 where available (Railway), else IPv4 only.
server.once('listening', () => console.log(`Tripley web serving ${root} on port ${port}`));
server.once('error', (err) => {
  if (err.code !== 'EAFNOSUPPORT') throw err;
  server.listen(port, '0.0.0.0');
});
server.listen(port, '::');
