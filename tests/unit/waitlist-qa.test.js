// @vitest-environment node
/**
 * Reproducibility tests for scripts/waitlist-qa.mjs.
 *
 * Playwright runs route handlers newest-first, and route.continue() sends the
 * request to the network (disk), NOT to older handlers. So /config.js must be
 * answered inside the one catch-all handler, from an immutable in-memory
 * fixture, or a broad handler registered later would silently serve whatever
 * public/config.js is on disk (tracked development, or a generated production
 * one that happens to mask the bug). Both disk variants are exercised here.
 */

import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import {
  ORIGIN, CONFIG_FIXTURES, FORBIDDEN, SCENARIOS,
  installRoutes, configMismatch, checkConfig, scanForbidden, parseHits,
} from '../../scripts/waitlist-qa.mjs';

const TRACKED_ON_DISK = "window.APP_CONFIG = {\n    API_BASE_URL: 'http://localhost:3000/api/v1',\n    ENVIRONMENT: 'development'\n};\n";
const GENERATED_ON_DISK = "window.APP_CONFIG = {\n    API_BASE_URL: 'https://api.localcoffeeshop.co/api/v1',\n    ENVIRONMENT: 'production'\n};\n";

const newState = (config, extra = {}) => ({
  config, collect: [], blocked: [], blockedLocal: [], unexpected: [], waitlistRequests: [],
  apiOrigins: new Set(), gtagLoads: 0, waitlist: {}, blockGtag: false, blockPaths: null, ...extra,
});

/** Fake Playwright context: newest handler first; continue() = disk, fallback() chains. */
function fakeContext(disk) {
  const handlers = [];
  return {
    route: async (_pattern, handler) => { handlers.push(handler); },
    async dispatch(url, { method = 'GET', postData = '' } = {}) {
      const parsed = new URL(url);
      for (let i = handlers.length - 1; i >= 0; i--) {
        let outcome = null;
        let fellBack = false;
        const route = {
          request: () => ({ url: () => url, method: () => method, postData: () => postData, resourceType: () => 'fetch' }),
          fulfill: async (spec) => { outcome = { action: 'fulfill', ...spec }; },
          continue: async () => { outcome = { action: 'continue', body: parsed.origin === ORIGIN ? disk[parsed.pathname] ?? null : null }; },
          abort: async (code = 'failed') => { outcome = { action: 'abort', code }; },
          fallback: async () => { fellBack = true; },
        };
        await handlers[i](route);
        if (!fellBack && outcome) return outcome;
      }
      throw new Error(`no route for ${url}`);
    },
  };
}

function runConfig(js) {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.runInNewContext(js, sandbox);
  return sandbox.APP_CONFIG;
}

describe('config fixtures', () => {
  it('are the tracked development and generated production shapes, and frozen', () => {
    expect(Object.keys(CONFIG_FIXTURES)).toEqual(['tracked-development', 'generated-production']);
    expect(runConfig(CONFIG_FIXTURES['tracked-development'].js)).toEqual({ API_BASE_URL: 'http://localhost:3000/api/v1', ENVIRONMENT: 'development' });
    expect(runConfig(CONFIG_FIXTURES['generated-production'].js)).toEqual({ API_BASE_URL: 'https://api.localcoffeeshop.co/api/v1', ENVIRONMENT: 'production' });
    for (const fx of Object.values(CONFIG_FIXTURES)) {
      expect(Object.isFrozen(fx)).toBe(true);
      expect(() => { 'use strict'; fx.js = 'x'; }).toThrow();
    }
    expect(Object.isFrozen(CONFIG_FIXTURES)).toBe(true);
  });
});

describe('installRoutes: /config.js comes from the fixture whatever is on disk', () => {
  it.each(Object.keys(CONFIG_FIXTURES))('%s fixture, against both a tracked and a generated config on disk', async (mode) => {
    for (const disk of [TRACKED_ON_DISK, GENERATED_ON_DISK]) {
      const ctx = fakeContext({ '/config.js': disk });
      const state = newState(CONFIG_FIXTURES[mode]);
      await installRoutes(ctx, state);
      const res = await ctx.dispatch(`${ORIGIN}/config.js`);
      expect(res.action).toBe('fulfill');
      expect(configMismatch(runConfig(res.body), CONFIG_FIXTURES[mode])).toBeNull();
      expect(state.unexpected).toEqual([]);
    }
  });

  it('DELIBERATE REGRESSION: a catch-all continue() registered later shadows the fixture, and the in-page check catches it', async () => {
    for (const mode of Object.keys(CONFIG_FIXTURES)) {
      const ctx = fakeContext({ '/config.js': mode === 'tracked-development' ? GENERATED_ON_DISK : TRACKED_ON_DISK });
      const state = newState(CONFIG_FIXTURES[mode]);
      await installRoutes(ctx, state);
      await ctx.route('**/*', (route) => route.continue()); // the regression
      const res = await ctx.dispatch(`${ORIGIN}/config.js`);
      expect(res.action).toBe('continue'); // served from disk, not the fixture
      const problem = configMismatch(runConfig(res.body), CONFIG_FIXTURES[mode]);
      expect(problem).toMatch(/is not the .* fixture/);
      await expect(checkConfig({ evaluate: async () => runConfig(res.body) }, state)).rejects.toThrow(/fixture/);
    }
  });

  it('checkConfig accepts exactly the fixture for its mode and nothing else', async () => {
    const dev = CONFIG_FIXTURES['tracked-development'];
    const prod = CONFIG_FIXTURES['generated-production'];
    await expect(checkConfig({ evaluate: async () => runConfig(dev.js) }, newState(dev))).resolves.toBeUndefined();
    await expect(checkConfig({ evaluate: async () => runConfig(prod.js) }, newState(dev))).rejects.toThrow();
    await expect(checkConfig({ evaluate: async () => undefined }, newState(prod))).rejects.toThrow();
    await expect(checkConfig({ evaluate: async () => ({ ...runConfig(prod.js), ENVIRONMENT: 'qa' }) }, newState(prod))).rejects.toThrow();
  });
});

describe('installRoutes: isolation', () => {
  it('mocks the API on the fixture origin only; the other mode’s API origin is unexpected', async () => {
    const dev = CONFIG_FIXTURES['tracked-development'];
    const ctx = fakeContext({});
    const state = newState(dev);
    await installRoutes(ctx, state);
    expect((await ctx.dispatch(`${dev.apiBase}/states`)).action).toBe('fulfill');
    expect([...state.apiOrigins]).toEqual(['http://localhost:3000']);
    const other = await ctx.dispatch(`${CONFIG_FIXTURES['generated-production'].apiBase}/states`);
    expect(other.action).toBe('abort');
    expect(state.unexpected.join()).toMatch(/unexpected external request/);
  });

  it('records blocked Google requests with the FULL url and body, and they are scanned', async () => {
    const ctx = fakeContext({});
    const state = newState(CONFIG_FIXTURES['generated-production']);
    await installRoutes(ctx, state);
    const res = await ctx.dispatch('https://www.googletagmanager.com/a?id=1&dr=http%3A%2F%2Fx%2F%3Fq%3DSecret%2BLatte', { method: 'POST', postData: 'email=qa.waitlist%2Bpii%40example.com' });
    expect(res.action).toBe('abort');
    expect(state.blocked).toHaveLength(1);
    expect(state.blocked[0]).toContain('?id=1&dr=');
    expect(state.blocked[0]).toContain('qa.waitlist');
    expect(scanForbidden(state.blocked[0]).length).toBeGreaterThan(0);
  });

  it('blockPaths aborts local scripts (privacy helper blocked) and records them', async () => {
    const ctx = fakeContext({ '/url-privacy.js': 'x' });
    const state = newState(CONFIG_FIXTURES['tracked-development'], { blockPaths: new Set(['/url-privacy.js']) });
    await installRoutes(ctx, state);
    expect((await ctx.dispatch(`${ORIGIN}/url-privacy.js`)).action).toBe('abort');
    expect(state.blockedLocal).toEqual(['/url-privacy.js']);
  });

  it('collect requests on any Google host are captured and answered locally', async () => {
    const ctx = fakeContext({});
    const state = newState(CONFIG_FIXTURES['tracked-development']);
    await installRoutes(ctx, state);
    for (const u of ['https://region1.google-analytics.com/g/collect?v=2&en=page_view', 'https://www.google.com/ccm/collect?en=x']) {
      expect((await ctx.dispatch(u)).status).toBe(204);
    }
    expect(state.collect).toHaveLength(2);
  });
});

describe('harness helpers and coverage', () => {
  it('parseHits splits batched hits and keeps shared params', () => {
    const hits = parseHits({ url: 'https://www.google-analytics.com/g/collect?v=2&dl=x&dr=y', postData: 'en=a\nen=b' });
    expect(hits.map((h) => [h.en, h.dl, h.dr])).toEqual([['a', 'x', 'y'], ['b', 'x', 'y']]);
  });

  it('the scanner catches every forbidden class, encoded or not', () => {
    for (const bad of ['qa.waitlist%2Bpii%40example.com', 'q=Secret+Latte', 'token=v2.x', 'QA_PRIVATE_REFERRER', 'PRIVATE_TOKEN_QA', 'qa.private%40example.com']) {
      expect(scanForbidden(`https://www.google-analytics.com/g/collect?dr=${bad}`).length, bad).toBeGreaterThan(0);
    }
    expect(scanForbidden('https://www.google-analytics.com/g/collect?en=page_view&dl=http%3A%2F%2F127.0.0.1%3A8189%2F')).toEqual([]);
    expect(FORBIDDEN).toEqual(expect.arrayContaining(['QA_PRIVATE_REFERRER', 'PRIVATE_TOKEN_QA']));
  });

  it('covers the required scenarios', () => {
    const names = SCENARIOS.map((s) => s.name);
    for (const n of ['home-dirty-referrer', 'direct-pages-dirty-query', 'helper-blocked-fails-closed', 'confirm-suppressed', 'confirm-ambiguous-not-counted',
      'confirm-invalid-token', 'home-analytics-blocked', 'strict-region-default-denied', 'live-reject-after-default-grant',
      'consent-helper-blocked-defaults-denied', 'roasters-filter-click-and-provider-error', 'collect-interception-selfcheck']) {
      expect(names, n).toContain(n);
    }
    expect(SCENARIOS.find((s) => s.name === 'home-dirty-referrer').referer).toContain('QA_PRIVATE_REFERRER');
  });
});
