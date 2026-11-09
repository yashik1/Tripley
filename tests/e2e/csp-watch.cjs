/**
 * Fails an end-to-end run if the browser blocked anything because of the
 * site's Content-Security-Policy (scripts/serve-web.cjs), and checks the
 * security headers are on the page.
 */
function watchCsp(browser) {
  const violations = [];
  const original = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const ctx = await original(...args);
    ctx.on('page', (page) =>
      page.on('console', (msg) => {
        const text = msg.text();
        if (/Content Security Policy|Refused to (load|connect|execute|apply|create|frame)/i.test(text)) {
          violations.push(text.slice(0, 300));
        }
      }),
    );
    return ctx;
  };
  return {
    async checkHeaders(request, url) {
      const res = await request.get(url);
      const h = res.headers();
      for (const name of ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy']) {
        if (!h[name]) throw new Error(`missing ${name} header on ${url}`);
      }
      return h;
    },
    assertNone() {
      if (violations.length) throw new Error(`Content-Security-Policy blocked:\n  ${[...new Set(violations)].join('\n  ')}`);
      console.log('  ✓ no Content-Security-Policy violations');
    },
  };
}

module.exports = { watchCsp };
