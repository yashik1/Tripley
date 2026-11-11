/** Security headers sent by the web server (scripts/serve-web.cjs). */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { securityHeaders } = createRequire(import.meta.url)('../../scripts/serve-web.cjs') as {
  securityHeaders: (env: Record<string, string | undefined>, https: boolean) => Record<string, string>;
};

const env = { EXPO_PUBLIC_SUPABASE_URL: 'https://api.tripley.test/' };
const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

describe('web security headers', () => {
  it('limits scripts and connections to this site, the API, the map, exchange rates and address search', () => {
    const csp = securityHeaders(env, true)['Content-Security-Policy'];
    expect(directive(csp, 'script-src')).toBe("script-src 'self'");
    expect(directive(csp, 'connect-src')).toBe(
      "connect-src 'self' blob: data: https://api.tripley.test wss://api.tripley.test https://tiles.openfreemap.org https://api.frankfurter.dev https://photon.komoot.io",
    );
    expect(directive(csp, 'img-src')).toBe("img-src 'self' data: blob: https: https://api.tripley.test");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(directive(csp, 'script-src')).not.toContain('unsafe-inline');
  });

  it('HSTS and HTTPS upgrades only behind HTTPS (so local http testing works)', () => {
    expect(securityHeaders(env, true)['Strict-Transport-Security']).toContain('max-age=31536000');
    expect(securityHeaders(env, false)['Strict-Transport-Security']).toBeUndefined();
    expect(securityHeaders(env, false)['Content-Security-Policy']).not.toContain('upgrade-insecure-requests');
  });

  it('no framing, no sniffing, limited device features', () => {
    const h = securityHeaders(env, true);
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Permissions-Policy']).toContain('microphone=()');
  });

  it('extra hosts must be plain https/wss origins (no directive injection)', () => {
    const csp = securityHeaders({ ...env, CSP_CONNECT_EXTRA: "https://ok.example wss://ws.example https://evil; script-src * javascript:x" }, true)[
      'Content-Security-Policy'
    ];
    expect(directive(csp, 'connect-src')).toContain('https://ok.example wss://ws.example');
    expect(csp).not.toContain('script-src *');
    expect(csp).not.toContain('evil;');
  });

  it('a self-hosted address search server replaces the public one', () => {
    const csp = securityHeaders({ ...env, EXPO_PUBLIC_GEOCODER_URL: 'https://geo.tripley.test/' }, true)['Content-Security-Policy'];
    expect(directive(csp, 'connect-src')).toContain('https://geo.tripley.test');
    expect(directive(csp, 'connect-src')).not.toContain('photon.komoot.io');
  });

  it('web purchases add only the payment provider’s hosts', () => {
    const csp = securityHeaders({ ...env, EXPO_PUBLIC_REVENUECAT_WEB_KEY: 'rcb_x' }, true)['Content-Security-Policy'];
    expect(directive(csp, 'script-src')).toBe("script-src 'self' https://js.stripe.com");
    expect(directive(csp, 'connect-src')).toContain('https://api.revenuecat.com');
  });
});
