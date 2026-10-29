// @vitest-environment node
/**
 * Unit & reproducibility regression tests for scripts/browser-qa.mjs.
 *
 * Playwright evaluates page.route() handlers in reverse registration order
 * (last registered runs first), and route.continue() sends the request to the
 * network rather than falling back to earlier page.route() handlers. If a
 * broad catch-all handler is registered after a /config.js override and calls
 * route.continue() for same-origin URLs, the browser receives public/config.js
 * from disk (tracked as http://localhost:3000/api/v1), breaking every QA
 * scenario unless a generated production config happens to mask the bug.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import {
  ORIGIN,
  QA_API_BASE_URL,
  QA_CONFIG_JS,
  HEALTHY,
  installRoutes,
  checkConfig,
} from '../../scripts/browser-qa.mjs';

const PUBLIC = resolve(__dirname, '../../public');
const TRACKED_CONFIG_JS = [
  '// Auto-generated configuration - DO NOT EDIT MANUALLY',
  'window.APP_CONFIG = {',
  "    API_BASE_URL: 'http://localhost:3000/api/v1',",
  "    ENVIRONMENT: 'development'",
  '};',
].join('\n');
const GENERATED_CONFIG_JS = [
  '// Auto-generated configuration - DO NOT EDIT MANUALLY',
  'window.APP_CONFIG = {',
  "    API_BASE_URL: 'https://api.localcoffeeshop.co/api/v1',",
  "    ENVIRONMENT: 'production'",
  '};',
].join('\n');
const API_CLIENT_JS = readFileSync(resolve(PUBLIC, 'api-client.js'), 'utf8');

function matchesPattern(pattern, url) {
  if (pattern === '**/*') return true;
  if (typeof pattern === 'string') return pattern === url;
  if (pattern instanceof RegExp) return pattern.test(url);
  if (typeof pattern === 'function') return pattern(new URL(url));
  return false;
}

/**
 * Fake Playwright Page that faithfully implements Playwright's route ordering:
 *   - Handlers run in reverse registration order (LIFO).
 *   - route.continue() goes straight to the origin server (on-disk files),
 *     NOT to earlier registered route handlers (only route.fallback() chains).
 */
function createPlaywrightPage({ diskFiles = { '/config.js': TRACKED_CONFIG_JS }, appConfig } = {}) {
  const routes = [];
  return {
    routes,
    async route(matcher, handler) {
      routes.push({ matcher, handler });
    },
    async evaluate(fn) {
      const win = { APP_CONFIG: appConfig };
      return fn.call(win);
    },
    async dispatch(url, { method = 'GET' } = {}) {
      const parsed = new URL(url);
      for (let i = routes.length - 1; i >= 0; i--) {
        const { matcher, handler } = routes[i];
        if (!matchesPattern(matcher, url)) continue;

        let outcome = null;
        let fellBack = false;
        const route = {
          request: () => ({
            url: () => url,
            method: () => method,
          }),
          fulfill: async (spec) => {
            outcome = { action: 'fulfill', status: spec.status ?? 200, ...spec };
          },
          continue: async () => {
            const diskBody = parsed.origin === ORIGIN ? (diskFiles[parsed.pathname] ?? null) : null;
            outcome = { action: 'continue', status: diskBody !== null ? 200 : 404, body: diskBody };
          },
          abort: async (errorCode = 'failed') => {
            outcome = { action: 'abort', errorCode };
          },
          fallback: async () => {
            fellBack = true;
          },
        };

        await handler(route, route.request());
        if (fellBack) continue;
        if (outcome) return outcome;
      }
      throw new Error(`No route matched ${url}`);
    },
  };
}

function evalConfigInWindow(code) {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

describe('browser-qa route ordering and deterministic /config.js', () => {
  it('reproduces Playwright LIFO + route.continue() semantics where a later **/* continue shadows an earlier route', async () => {
    const page = createPlaywrightPage({ diskFiles: { '/config.js': TRACKED_CONFIG_JS } });
    await page.route(`${ORIGIN}/config.js`, (route) => route.fulfill({ body: QA_CONFIG_JS }));
    await page.route('**/*', (route) => route.continue());

    const res = await page.dispatch(`${ORIGIN}/config.js`);
    expect(res.action).toBe('continue');
    const win = evalConfigInWindow(res.body);
    expect(win.APP_CONFIG).toEqual({
      API_BASE_URL: 'http://localhost:3000/api/v1',
      ENVIRONMENT: 'development',
    });
  });

  it.each([
    ['tracked development config', TRACKED_CONFIG_JS],
    ['generated production config', GENERATED_CONFIG_JS],
  ])('fulfills /config.js with deterministic QA APP_CONFIG instead of continuing to %s on disk', async (_label, diskConfig) => {
    const page = createPlaywrightPage({ diskFiles: { '/config.js': diskConfig } });
    const unexpected = [];
    await installRoutes(page, { api: HEALTHY }, unexpected);

    const res = await page.dispatch(`${ORIGIN}/config.js`);
    expect(res.action).toBe('fulfill');
    expect(res.contentType).toContain('application/javascript');

    const win = evalConfigInWindow(res.body);
    expect(win.APP_CONFIG).toEqual({
      API_BASE_URL: 'https://api.localcoffeeshop.co/api/v1',
      ENVIRONMENT: 'qa',
    });
    expect(win.APP_CONFIG.API_BASE_URL).toBe(QA_API_BASE_URL);
    expect(unexpected).toEqual([]);
  });

  it('points ApiClient at the mocked production API host when initialized with the routed /config.js', async () => {
    const page = createPlaywrightPage();
    const unexpected = [];
    await installRoutes(page, { api: HEALTHY }, unexpected);

    const configRes = await page.dispatch(`${ORIGIN}/config.js`);
    const requestedUrls = [];

    const sandbox = {
      fetch: async (input, init = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        requestedUrls.push(url);
        const routed = await page.dispatch(url, { method: init.method || 'GET' });
        if (routed.action === 'abort') throw new TypeError(`Failed to fetch: ${routed.errorCode}`);
        return new Response(routed.body, {
          status: routed.status ?? 200,
          headers: { 'content-type': routed.contentType || 'application/json' },
        });
      },
      AbortController,
      setTimeout,
      clearTimeout,
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    vm.createContext(sandbox);

    vm.runInContext(configRes.body, sandbox, { filename: 'config.js' });
    expect(sandbox.window.APP_CONFIG.API_BASE_URL).toBe('https://api.localcoffeeshop.co/api/v1');

    vm.runInContext(API_CLIENT_JS, sandbox, { filename: 'api-client.js' });
    const states = await sandbox.window.ApiClient.get('/states');

    expect(requestedUrls).toEqual(['https://api.localcoffeeshop.co/api/v1/states']);
    expect(states).toEqual([
      { state_code: 'CA', shop_count: 3, avg_price_level: 2.1 },
      { state_code: 'TX', shop_count: 2, avg_price_level: 1.6 },
    ]);
    expect(unexpected).toEqual([]);
  });

  it('continues other same-origin static assets and blocks unexpected or non-GET requests', async () => {
    const page = createPlaywrightPage({
      diskFiles: {
        '/config.js': TRACKED_CONFIG_JS,
        '/html/index.html': '<!doctype html>',
      },
    });
    const unexpected = [];
    await installRoutes(page, { api: HEALTHY }, unexpected);

    const htmlRes = await page.dispatch(`${ORIGIN}/html/index.html`);
    expect(htmlRes.action).toBe('continue');

    const gaRes = await page.dispatch('https://www.googletagmanager.com/gtag/js?id=G-TEST');
    expect(gaRes.action).toBe('abort');
    expect(unexpected).toEqual([]);

    const postRes = await page.dispatch('https://api.localcoffeeshop.co/api/v1/states', { method: 'POST' });
    expect(postRes.action).toBe('abort');
    expect(unexpected).toEqual(['non-GET API request: POST https://api.localcoffeeshop.co/api/v1/states']);

    const localhostRes = await page.dispatch('http://localhost:3000/api/v1/states');
    expect(localhostRes.action).toBe('abort');
    expect(unexpected).toContain('unexpected external request: GET http://localhost:3000/api/v1/states');
  });

  it('checkConfig accepts only the deterministic QA APP_CONFIG and rejects tracked or generated disk configs', async () => {
    const qaPage = { evaluate: async () => ({ API_BASE_URL: QA_API_BASE_URL, ENVIRONMENT: 'qa' }) };
    await expect(checkConfig(qaPage)).resolves.toBeUndefined();

    const trackedDiskPage = { evaluate: async () => ({ API_BASE_URL: 'http://localhost:3000/api/v1', ENVIRONMENT: 'development' }) };
    await expect(checkConfig(trackedDiskPage)).rejects.toThrow(/expected deterministic QA APP_CONFIG/);

    // Generated config (npm run build:config without .env) has the prod URL but ENVIRONMENT !== 'qa'.
    const generatedDiskPage = { evaluate: async () => ({ API_BASE_URL: QA_API_BASE_URL, ENVIRONMENT: 'production' }) };
    await expect(checkConfig(generatedDiskPage)).rejects.toThrow(/expected deterministic QA APP_CONFIG/);
  });
});
