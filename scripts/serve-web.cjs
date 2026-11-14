#!/usr/bin/env node
/**
 * Serves the exported web app (dist/) for hosting on Railway or any Node host.
 * - Unknown paths fall back to index.html (client-side routing, e.g. /join/<code>)
 *   but a missing file (a path with an extension) is a 404, not the HTML page
 * - /.well-known/* (iOS universal links, Android app links) served as JSON
 * - Fingerprinted assets under /_expo/static and /assets get long cache headers
 * - Security headers on every response: a Content-Security-Policy limited to
 *   this site, the Supabase API, the map tiles and the exchange-rate service;
 *   no framing; HSTS behind HTTPS. Extra hosts: CSP_CONNECT_EXTRA="https://a https://b".
 *
 *   node scripts/serve-web.cjs [dir=dist]      (listens on $PORT, default 8081)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

function originOf(u) {
  try {
    return u ? new URL(u).origin : null;
  } catch {
    return null;
  }
}

/** Security headers for every response. `https` = the request reached us over HTTPS. */
function securityHeaders(env, https) {
  const supabase = originOf(env.EXPO_PUBLIC_SUPABASE_URL);
  const webPurchases = !!env.EXPO_PUBLIC_REVENUECAT_WEB_KEY;
  const connect = [
    "'self'",
    // Photos picked on the web are read from in-page blob:/data: addresses before upload.
    'blob:',
    'data:',
    // Without a configured API address, allow any secure host rather than break the app.
    ...(supabase ? [supabase, supabase.replace(/^http/, 'ws')] : ['https:', 'wss:']),
    'https://tiles.openfreemap.org',
    originOf(env.EXPO_PUBLIC_MAP_STYLE_URL),
    'https://api.frankfurter.dev',
    // Address and place search (src/lib/geocode.ts).
    originOf(env.EXPO_PUBLIC_GEOCODER_URL) || 'https://photon.komoot.io',
    // Weather for packing suggestions (src/lib/weather.ts).
    originOf(env.EXPO_PUBLIC_WEATHER_URL) || 'https://api.open-meteo.com',
    originOf(env.EXPO_PUBLIC_WEATHER_ARCHIVE_URL) || 'https://archive-api.open-meteo.com',
    // A famous photo of the trip's destination (src/lib/place-photo.ts); the photo itself is an image (img-src).
    'https://en.wikipedia.org',
    'https://commons.wikimedia.org',
    ...(webPurchases ? ['https://api.revenuecat.com', 'https://api.stripe.com'] : []),
    ...String(env.CSP_CONNECT_EXTRA || '').split(/\s+/).filter((x) => /^(https|wss):\/\/[^\s;,']+$/.test(x)),
  ].filter(Boolean);
  const csp = [
    "default-src 'self'",
    `script-src 'self'${webPurchases ? ' https://js.stripe.com' : ''}`,
    // React Native Web writes its styles at runtime.
    "style-src 'self' 'unsafe-inline'",
    // Avatars from sign-in providers, signed photo links, map sprites.
    `img-src 'self' data: blob: https:${supabase ? ` ${supabase}` : ''}`,
    "font-src 'self' data:",
    `connect-src ${[...new Set(connect)].join(' ')}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    `frame-src ${webPurchases ? 'https://js.stripe.com https://hooks.stripe.com' : "'none'"}`,
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=(), usb=(), payment=(self), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    ...(https ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}

module.exports = { securityHeaders, robotsTxt, sitemapXml, publicOrigin };

const root = path.resolve(process.argv[2] || 'dist');
const port = Number(process.env.PORT || 8081);
const index = path.join(root, 'index.html');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
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

/** Pages anyone can read (the rest needs an account, or is someone's trip). */
const PUBLIC_PAGES = ['/', '/why-tripley', '/privacy', '/terms', '/sign-up', '/sign-in'];

/** This site's address: the configured domain, else the host the request came to. */
function publicOrigin(req) {
  const domain = (process.env.EXPO_PUBLIC_APP_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const host = /^[A-Za-z0-9.-]+(:\d+)?$/.test(domain) && domain ? domain : String(req.headers.host || 'localhost').replace(/[^A-Za-z0-9.:-]/g, '');
  const proto = req.headers['x-forwarded-proto'] === 'https' || !/^(localhost|127\.)/.test(host) ? 'https' : 'http';
  return `${proto}://${host}`;
}

function robotsTxt(origin) {
  return ['User-agent: *', 'Allow: /', 'Disallow: /trip/', 'Disallow: /join/', 'Disallow: /profile', 'Disallow: /notifications', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n');
}

function sitemapXml(origin) {
  const urls = PUBLIC_PAGES.map((p) => `  <url><loc>${origin}${p === '/' ? '/' : p}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function serve() {
if (!fs.existsSync(index)) {
  console.error(`No ${index}. Run "npx expo export --platform web" first.`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
    const https = req.headers['x-forwarded-proto'] === 'https';
    const security = securityHeaders(process.env, https);
    let urlPath;
    try {
      urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.writeHead(400, security).end('Bad request');
      return;
    }
    // Search engines: the public pages, and keep private trip pages out.
    if (urlPath === '/robots.txt' || urlPath === '/sitemap.xml') {
      const origin = publicOrigin(req);
      const body = urlPath === '/robots.txt' ? robotsTxt(origin) : sitemapXml(origin);
      res
        .writeHead(200, { ...security, 'Content-Type': urlPath === '/robots.txt' ? 'text/plain; charset=utf-8' : 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
        .end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    let file = path.join(root, path.normalize(urlPath));
    if (!file.startsWith(root)) {
      res.writeHead(403, security).end('Forbidden');
      return;
    }
    let isFile = false;
    try {
      isFile = fs.statSync(file).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) {
      // Routes have no extension; a missing script or image must not get HTML
      // back (a browser would run or cache it as the wrong type).
      if (path.extname(urlPath)) {
        res.writeHead(404, { ...security, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }).end('Not found');
        return;
      }
      file = index;
    }

    const headers = {
      ...security,
      'Content-Type': urlPath.startsWith('/.well-known/') ? 'application/json' : TYPES[path.extname(file)] || 'application/octet-stream',
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
}

if (require.main === module) serve();
