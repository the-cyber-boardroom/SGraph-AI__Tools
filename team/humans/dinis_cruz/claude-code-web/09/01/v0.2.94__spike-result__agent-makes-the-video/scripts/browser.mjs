// browser.mjs — shared Playwright launcher for the spike scripts.
//
// Finding: in this container Chromium cannot complete a TLS handshake through
// the agent proxy (every https:// navigation is ERR_CONNECTION_RESET, while
// curl and Node's fetch through the same proxy work). So the browser is kept
// on plain http://localhost and every external request is routed through
// Node's fetch (NODE_USE_ENV_PROXY=1 + the proxy CA bundle) and fulfilled.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
// NODE_PATH is honoured by require(), not by ESM import — hence the shim.
const { chromium } = createRequire(import.meta.url)('playwright');

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Responses above this size are written to CACHE_DIR and served by
// cache-server.mjs: fulfilling a ~92 MB body through CDP killed the page.
const BIG = 8 * 1024 * 1024;
export const CACHE_DIR = process.env.CACHE_DIR || path.resolve('cache');
export const CACHE_URL = process.env.CACHE_URL || 'http://127.0.0.1:10064';
const cachePath = (url) => { const u = new URL(url); return path.join(CACHE_DIR, u.host, u.pathname); };

export async function launch({ headless = true, args = [] } = {}) {
  return chromium.launch({
    headless,
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage', ...args],
  });
}

/** Route every non-localhost request through Node's fetch. Returns stats. */
export async function bridge(target, { log = false } = {}) {
  const stats = { requests: 0, bytes: 0, failed: 0 };
  await target.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, async route => {
    const req = route.request();
    stats.requests++;
    const cp = cachePath(req.url());
    if (req.method() === 'GET' && fs.existsSync(cp)) {
      stats.cached = (stats.cached || 0) + 1;
      return route.fulfill({ status: 302, headers: { location: `${CACHE_URL}/${path.relative(CACHE_DIR, cp)}` } });
    }
    try {
      const r = await fetch(req.url(), {
        method: req.method(),
        headers: Object.fromEntries(Object.entries(req.headers()).filter(([k]) => !/^(host|connection|content-length|accept-encoding)$/i.test(k))),
        body: req.postDataBuffer() ?? undefined,
        redirect: 'follow',
      });
      const body = Buffer.from(await r.arrayBuffer());
      stats.bytes += body.length;
      if (log) console.log('  [bridge]', r.status, req.url().slice(0, 100), body.length);
      const headers = {};
      r.headers.forEach((v, k) => { if (!/^(content-encoding|content-length|transfer-encoding|connection)$/i.test(k)) headers[k] = v; });
      headers['access-control-allow-origin'] = '*';
      if (body.length > BIG && r.status === 200 && req.method() === 'GET') {
        fs.mkdirSync(path.dirname(cp), { recursive: true });
        fs.writeFileSync(cp, body);
        if (log) console.log('  [bridge] cached ->', path.relative(CACHE_DIR, cp));
        return route.fulfill({ status: 302, headers: { location: `${CACHE_URL}/${path.relative(CACHE_DIR, cp)}` } });
      }
      await route.fulfill({ status: r.status, headers, body });
    } catch (e) {
      stats.failed++;
      if (log) console.log('  [bridge] FAIL', req.url().slice(0, 100), e.message.slice(0, 120));
      await route.abort();
    }
  });
  return stats;
}

export async function context(browser, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...extra });
  ctx.bridgeStats = await bridge(ctx, { log: !!process.env.BRIDGE_LOG });
  return ctx;
}
