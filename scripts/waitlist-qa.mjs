#!/usr/bin/env node
/**
 * Browser QA for the roaster-subscription interest list + privacy-safe
 * analytics (homepage, /roasters/, /waitlist/confirm/, /waitlist/unsubscribe/).
 *
 *   npm run build:js && npm run build:css && npm run build:roasters
 *   npm run qa:waitlist          # QA_OUT_DIR=<dir> keeps evidence + screenshots
 *
 * Isolation (set up on the browser CONTEXT before the first navigation):
 *   - every request is default-denied by one route handler; service workers
 *     are blocked;
 *   - same-origin static files are served by a built-in server on
 *     127.0.0.1:8189 (fails fast if the port is taken; one server, scenarios
 *     run sequentially — never alongside another browser runner);
 *   - /config.js is answered from memory with one of two IMMUTABLE fixtures,
 *     so public/config.js on disk is never read or written (checked by hash
 *     at the end, with `git status` of tracked files). The whole suite runs
 *     once per fixture:
 *       tracked-development   = what git tracks (localhost:3000, development)
 *       generated-production  = what `npm run build:config` emits
 *                               (api.localcoffeeshop.co, production)
 *     and EVERY scenario asserts, in the page, that window.APP_CONFIG equals
 *     the fixture and that every API request went to the fixture's origin;
 *   - the API is mocked per scenario on the fixture's origin, so no waitlist
 *     request reaches a real backend or email provider;
 *   - the GENUINE Google tag script (gtag.js) is fetched from Google, but every
 *     GA collection request on any host (…/g/collect, google.com/…/collect,
 *     doubleclick, sendBeacon/fetch/XHR) is intercepted, recorded and answered
 *     locally with 204 — no event reaches Google; any other external request
 *     is aborted and fails the run.
 *
 * Assertions are made on the captured collection payloads (en, ep.*, dl, dr,
 * gcs), not on dataLayer: event names/params, consent state, and that no
 * email address, token or raw search text appears in any collect URL/body,
 * nor in any blocked Google request (full URL + body).
 *
 * QA_MODES=tracked-development,generated-production (default: both)
 * QA_ONLY=<substring of a scenario name> (debugging only)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, devices } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const PORT = 8189;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT_DIR = process.env.QA_OUT_DIR || null;

/**
 * Immutable config fixtures (frozen; never derived from the files on disk).
 * `js` is exactly what the page receives for /config.js.
 */
function fixture(name, apiOrigin, environment) {
    const apiBase = `${apiOrigin}/api/v1`;
    return Object.freeze({
        name,
        apiOrigin,
        apiBase,
        environment,
        js: ['// QA fixture: ' + name, 'window.APP_CONFIG = {', `    API_BASE_URL: '${apiBase}',`, `    ENVIRONMENT: '${environment}'`, '};', ''].join('\n'),
    });
}
const CONFIG_FIXTURES = Object.freeze({
    'tracked-development': fixture('tracked-development', 'http://localhost:3000', 'development'),
    'generated-production': fixture('generated-production', 'https://api.localcoffeeshop.co', 'production'),
});
const ROASTERS = JSON.parse(readFileSync(join(ROOT, 'data/roasters.json'), 'utf8')).roasters;
const GTAG_URL = 'https://www.googletagmanager.com/gtag/js?id=G-YVSXN7PM48';

// Strings that must never appear in anything sent to Google.
const QA_EMAIL = 'qa.waitlist+pii@example.com';
const QA_SEARCH = 'Secret Latte';
const QA_ROASTER_SEARCH = 'Secret Roast';
const QA_TOKEN = 'v2.QAtokenDoNotLeak_0123456789abcdef';
// (Not bare "Roast": the /roasters/ page title legitimately contains "Roasters".)
const QA_DIRTY_REFERRER = `http://127.0.0.1:8189/?q=QA_PRIVATE_REFERRER&email=qa.private%40example.com&TOKEN=PRIVATE_TOKEN_QA`;
const QA_DIRTY_QUERY = `q=${encodeURIComponent(QA_SEARCH).replace(/%20/g, '+')}&email=${encodeURIComponent(QA_EMAIL)}&token=${QA_TOKEN}`;
const FORBIDDEN = [QA_EMAIL, 'example.com', 'qa.waitlist', QA_SEARCH, QA_ROASTER_SEARCH, 'Secret', 'Latte', QA_TOKEN, 'QAtokenDoNotLeak', 'token=',
    'QA_PRIVATE_REFERRER', 'qa.private', 'PRIVATE_TOKEN_QA'];

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.xml': 'application/xml',
    '.txt': 'text/plain',
};
// As deployed: build:html copies public/html/*.html to public/.
const PAGE_ALIASES = { '/': '/html/index.html', '/index.html': '/html/index.html' };

// ---------------------------------------------------------------------------
// Tracked-file immutability
// ---------------------------------------------------------------------------

function git(args) {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}
function trackedSnapshot() {
    return {
        status: git(['status', '--porcelain', '--untracked-files=no']),
        configSha256: crypto.createHash('sha256').update(readFileSync(join(PUBLIC, 'config.js'))).digest('hex'),
    };
}

// ---------------------------------------------------------------------------
// Static server
// ---------------------------------------------------------------------------

function startServer() {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, ORIGIN);
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405).end();
            return;
        }
        let pathname = PAGE_ALIASES[url.pathname] || url.pathname;
        if (pathname.endsWith('/')) pathname += 'index.html';
        const file = normalize(join(PUBLIC, decodeURIComponent(pathname)));
        if (!file.startsWith(PUBLIC + '/')) {
            res.writeHead(403).end();
            return;
        }
        try {
            const body = await readFile(file);
            res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
            res.end(body);
        } catch {
            res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        }
    });
    return new Promise((resolvePromise, reject) => {
        server.once('error', (err) => reject(err.code === 'EADDRINUSE'
            ? new Error(`Port ${PORT} is already in use; stop whatever is on it (waitlist QA owns ${PORT}).`)
            : err));
        server.listen(PORT, '127.0.0.1', () => resolvePromise(server));
    });
}

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------

const STATES = [{ state_code: 'CA', shop_count: 2, avg_price_level: 2 }, { state_code: 'TX', shop_count: 1, avg_price_level: 1 }];
const SHOPS = [
    { id: 1, displayName: { text: 'Secret Latte Bar' }, formattedAddress: '1 Market St, San Francisco, CA 94105, USA', state: 'CA', priceLevel: 'PRICE_LEVEL_MODERATE' },
    { id: 2, displayName: { text: 'Bean Counter' }, formattedAddress: '2 Mission St, San Francisco, CA', state: 'CA', priceLevel: 'PRICE_LEVEL_INEXPENSIVE' },
];
const ok = (data, metadata) => ({ status: 200, body: { success: true, data, ...(metadata ? { metadata } : {}) } });
const err = (status, code) => ({ status, body: { success: false, error: { code, message: code, statusCode: status } } });

function readApi(path) {
    if (path === '/health') return ok({ status: 'ok' });
    if (path === '/config') return ok({ frontendUrl: ORIGIN });
    if (path === '/states') return ok(STATES);
    if (path === '/search' || path.startsWith('/states/')) {
        return ok(SHOPS, { pagination: { page: 1, limit: 100, total: SHOPS.length, hasNext: false } });
    }
    return null;
}

// ---------------------------------------------------------------------------
// GA payload capture + parsing
// ---------------------------------------------------------------------------

const isCollect = (url) => /(^|\/)(g\/collect|collect|j\/collect|mp\/collect|ccm\/collect)$/.test(url.pathname)
    || /\/collect$/.test(url.pathname);

/** One GA4 request can batch several hits: shared params in the URL, one line per hit in the body. */
function parseHits(record) {
    const url = new URL(record.url);
    const shared = Object.fromEntries(url.searchParams);
    const lines = (record.postData || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return [{ ...shared, _host: url.hostname, _path: url.pathname }];
    return lines.map((line) => ({ ...shared, ...Object.fromEntries(new URLSearchParams(line)), _host: url.hostname, _path: url.pathname }));
}

function scanForbidden(text) {
    const variants = (s) => [s, encodeURIComponent(s), encodeURIComponent(s).replace(/%20/g, '+'), s.replace(/ /g, '+')];
    const hay = [text];
    try { hay.push(decodeURIComponent(text)); } catch { /* ignore */ }
    const lower = hay.join('\n').toLowerCase();
    return FORBIDDEN.flatMap(variants).filter((needle) => lower.includes(needle.toLowerCase()));
}

// Secondary capture channel: wrap sendBeacon / fetch / XHR in the page so
// beacon transport is observed even if a browser bypassed routing.
const BEACON_SPY = `(() => {
  const log = (kind, url, body) => {
    try {
      const u = String(url);
      if (!/collect/.test(u)) return;
      (window.__gaSpy = window.__gaSpy || []).push({ kind, url: u, body: typeof body === 'string' ? body : (body ? '[non-string]' : '') });
    } catch (e) {}
  };
  if (navigator.sendBeacon) {
    const orig = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => { log('beacon', url, data); return orig(url, data); };
  }
  const origFetch = window.fetch;
  window.fetch = function (input, init) { log('fetch', input && input.url ? input.url : input, init && init.body); return origFetch.apply(this, arguments); };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url) { this.__u = url; return open.apply(this, arguments); };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) { log('xhr', this.__u, body); return send.apply(this, arguments); };
})();`;

function consentInit(kind) {
    if (!kind) return null;
    const v = kind === 'granted' ? 'granted' : 'denied';
    const consent = {
        analytics_storage: v, ad_storage: v, ad_user_data: v, ad_personalization: v,
        functionality_storage: 'granted', security_storage: 'granted',
    };
    return `try { localStorage.setItem('cookie_consent', ${JSON.stringify(JSON.stringify({ version: '1.0', timestamp: '2026-10-20T00:00:00.000Z', consent }))}); } catch (e) {}`;
}

/**
 * One catch-all handler (Playwright runs handlers newest-first and
 * route.continue() goes to the network, not to older handlers, so /config.js
 * MUST be answered inside this handler: see tests/unit/waitlist-qa.test.js).
 * state: { config: fixture, api..., blockPaths?: Set<pathname> }
 */
async function installRoutes(context, state) {
    await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();

        if (url.origin === ORIGIN) {
            if (url.pathname === '/config.js') return route.fulfill({ contentType: 'application/javascript', body: state.config.js });
            if (state.blockPaths && state.blockPaths.has(url.pathname)) {
                state.blockedLocal.push(url.pathname);
                return route.abort('blockedbyclient');
            }
            if (method !== 'GET') {
                state.unexpected.push(`non-GET same-origin request ${method} ${url.pathname}`);
                return route.abort();
            }
            return route.continue();
        }

        if (url.origin === state.config.apiOrigin) {
            state.apiOrigins.add(url.origin);
            if (method === 'OPTIONS') {
                // CORS preflight for the JSON POST, answered like the real API's cors().
                return route.fulfill({ status: 204, headers: {
                    'access-control-allow-origin': ORIGIN,
                    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
                    'access-control-allow-headers': 'Content-Type, Authorization, Idempotency-Key',
                } });
            }
            const m = url.pathname.match(/^\/api\/v1(\/.*)$/);
            const path = m ? m[1] : url.pathname;
            if (path.startsWith('/waitlist/')) {
                const body = request.postData();
                state.waitlistRequests.push({ method, path, origin: url.origin, body: body ? JSON.parse(body) : null, at: Date.now() });
                const handler = method === 'POST' ? state.waitlist[path] : null;
                const result = typeof handler === 'function' ? handler(state) : handler;
                if (!result) {
                    state.unexpected.push(`unmocked waitlist request ${method} ${path}`);
                    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"success":false}' });
                }
                if (result === 'network-error') return route.abort('internetdisconnected');
                return route.fulfill({ status: result.status, contentType: 'application/json', headers: { 'access-control-allow-origin': ORIGIN }, body: JSON.stringify(result.body) });
            }
            const result = method === 'GET' ? readApi(path) : null;
            if (!result) {
                state.unexpected.push(`unexpected API request ${method} ${url}`);
                return route.abort();
            }
            return route.fulfill({ status: result.status, contentType: 'application/json', headers: { 'access-control-allow-origin': ORIGIN }, body: JSON.stringify(result.body) });
        }

        // Google measurement: capture every collection request on any host, answer locally.
        if (/google|doubleclick|googletagmanager|googlesyndication/.test(url.hostname) && isCollect(url)) {
            state.collect.push({ url: url.href, method, postData: request.postData() || '', resourceType: request.resourceType(), at: Date.now() });
            return route.fulfill({ status: 204, body: '' });
        }

        // Only the genuine Google tag script may load from the network.
        if (method === 'GET' && url.href === GTAG_URL && !state.blockGtag) {
            state.gtagLoads++;
            return route.continue();
        }
        if (method === 'GET' && url.href === GTAG_URL && state.blockGtag) {
            state.blocked.push(blockedEntry(method, url, request));
            return route.abort('blockedbyclient');
        }

        if (/google|doubleclick|googletagmanager|googlesyndication|gstatic/.test(url.hostname)) {
            // e.g. Google signals / ads pings: never sent; recorded.
            state.blocked.push(blockedEntry(method, url, request));
            return route.abort('blockedbyclient');
        }
        state.unexpected.push(`unexpected external request ${method} ${url.href}`);
        return route.abort('blockedbyclient');
    });
}

/** A blocked Google request, recorded in full (URL with query + body) so it can be scanned. */
function blockedEntry(method, url, request) {
    return `${method} ${url.href}\n${request.postData() || ''}`;
}

/** null when the page's APP_CONFIG is exactly the fixture's, else why not. */
function configMismatch(actual, fx) {
    const want = { API_BASE_URL: fx.apiBase, ENVIRONMENT: fx.environment };
    return actual && actual.API_BASE_URL === want.API_BASE_URL && actual.ENVIRONMENT === want.ENVIRONMENT
        ? null
        : `window.APP_CONFIG ${JSON.stringify(actual)} is not the ${fx.name} fixture ${JSON.stringify(want)}`;
}

async function checkConfig(page, state) {
    const problem = configMismatch(await page.evaluate(() => window.APP_CONFIG), state.config);
    if (problem) throw new Error(problem);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function check(condition, message) {
    if (!condition) throw new Error(message);
}

async function waitUntil(fn, { timeout = 20000, interval = 200, message = 'condition' } = {}) {
    const start = Date.now();
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${message}`);
        await new Promise((r) => setTimeout(r, interval));
    }
}

const hitsOf = (state) => state.collect.flatMap(parseHits);
const events = (state, name) => hitsOf(state).filter((h) => h.en === name);

async function waitForEvent(state, name, predicate = () => true, timeout = 20000) {
    return waitUntil(() => events(state, name).find(predicate), { timeout, message: `GA hit en=${name}` });
}

async function noHorizontalOverflow(page) {
    const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
    check(scroll <= width + 1, `page scrolls horizontally (${scroll}px wide in a ${width}px viewport)`);
}

async function addressBar(page) {
    return page.evaluate(() => location.href);
}

const subscribeOk = { status: 202, body: { success: true, data: { status: 'pending_confirmation' } } };

async function fillWaitlistByKeyboard(page, source) {
    await page.locator(`#waitlist-email-${source}`).focus();
    await page.keyboard.type(QA_EMAIL);
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.name);
    check(focused === 'consent', `Tab from email went to "${focused}", expected the consent checkbox (honeypot must be skipped)`);
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    const onButton = await page.evaluate(() => document.activeElement && document.activeElement.className);
    check(/waitlist-submit/.test(onButton), `Tab from consent went to "${onButton}", expected the submit button`);
    await page.keyboard.press('Enter');
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const SCENARIOS = [
    {
        name: 'home-consent-granted-search-and-signup',
        consent: 'granted',
        path: `/?q=${encodeURIComponent(QA_SEARCH).replace(/%20/g, '+')}&state=CA`,
        waitlist: { '/waitlist/subscribe': subscribeOk },
        async run(page, state) {
            const pageView = await waitForEvent(state, 'page_view');
            check(!/[?&]q=/.test(pageView.dl) && pageView.dl.includes('state=CA'), `page_view dl was ${pageView.dl}`);
            check(/^G1/.test(pageView.gcs || '') && pageView.gcs === 'G111', `granted page_view gcs=${pageView.gcs}`);
            check(!/[?&]q=/.test(await addressBar(page)), 'address bar still has ?q=');
            await page.locator('#searchResults .coffee-item').first().waitFor();
            check(await page.locator('#searchInput').inputValue() === QA_SEARCH, 'deep-linked query not in the search box');
            // The deep-linked initial render is NOT a person searching.
            await page.waitForTimeout(2500);
            check(events(state, 'directory_search').length === 0, `initial deep link counted as a search (${events(state, 'directory_search').length})`);
            check(!pageView.dr, `deep-link page_view dr=${pageView.dr}`);
            await page.fill('#searchInput', 'Bean');
            const search = await waitForEvent(state, 'directory_search');
            check(search['ep.search_has_query'] === 'yes' && search['ep.search_state'] === 'CA' && search['ep.search_price'] === 'any', `directory_search params ${JSON.stringify(search)}`);
            check(search['epn.result_count'] === '2', `directory_search result_count ${search['epn.result_count']}`);
            check(search.tid === 'G-YVSXN7PM48', `directory_search tid ${search.tid}`);
            await page.waitForTimeout(1500);
            check(events(state, 'directory_search').length === 1, `directory_search counted ${events(state, 'directory_search').length} times for one search`);

            await page.locator('#waitlist-home').scrollIntoViewIfNeeded();
            check(!(await page.locator('#waitlist-consent-home').isChecked()), 'consent checkbox pre-checked');
            await fillWaitlistByKeyboard(page, 'home');
            const success = page.locator('#waitlist-home .waitlist-success');
            await success.waitFor({ state: 'visible' });
            check(/check your inbox/i.test(await success.textContent()) && !/we.ve sent|we sent/i.test(await success.textContent()), 'success panel text');
            check(await page.evaluate(() => document.activeElement.classList.contains('waitlist-success')), 'focus not moved to the success panel');
            check(state.waitlistRequests.length === 1, `expected one subscribe request, got ${state.waitlistRequests.length}`);
            const body = state.waitlistRequests[0].body;
            check(body.email === QA_EMAIL && body.consent === true && body.source === 'home' && body.company === '', `subscribe body ${JSON.stringify(body)}`);
            await waitForEvent(state, 'waitlist_signup_attempt', (h) => h['ep.waitlist_source'] === 'home');
            await waitForEvent(state, 'waitlist_request_accepted', (h) => h['ep.waitlist_source'] === 'home');
            check(events(state, 'waitlist_signup_accepted').length === 0, 'retired waitlist_signup_accepted event sent');
            check(events(state, 'waitlist_confirmed').length === 0, 'waitlist_confirmed sent on signup');
            const cookies = await page.context().cookies();
            check(cookies.some((c) => c.name === '_ga'), 'granted consent but no _ga cookie');
        },
    },
    {
        name: 'home-consent-denied-validation-and-unavailable',
        consent: 'denied',
        path: '/',
        waitlist: { '/waitlist/subscribe': err(503, 'WAITLIST_UNAVAILABLE') },
        async run(page, state) {
            const pageView = await waitForEvent(state, 'page_view');
            check(pageView.gcs === 'G100', `denied page_view gcs=${pageView.gcs} (expected G100)`);
            await page.locator('#stateGrid .state-card').first().waitFor();
            await page.locator('#waitlist-home .waitlist-submit').click();
            check(await page.locator('#waitlist-email-home').getAttribute('aria-invalid') === 'true', 'empty email not flagged');
            check(await page.locator('#waitlist-consent-home').getAttribute('aria-invalid') === 'true', 'missing consent not flagged');
            check(await page.evaluate(() => document.activeElement.id) === 'waitlist-email-home', 'focus not on first invalid field');
            check(/enter your email/i.test(await page.locator('#waitlist-email-error-home').textContent()), 'email error text');
            check(state.waitlistRequests.length === 0, 'request sent despite invalid input');
            await page.locator('#waitlist-email-home').fill(QA_EMAIL);
            await page.locator('#waitlist-consent-home').check();
            await page.locator('#waitlist-home .waitlist-submit').click();
            const alert = page.locator('#waitlist-home .waitlist-alert');
            await alert.waitFor({ state: 'visible' });
            check(/isn.t open/i.test(await alert.textContent()), `503 alert text: ${await alert.textContent()}`);
            check(await page.locator('#waitlist-home .waitlist-submit').isEnabled(), 'submit not re-enabled');
            await waitForEvent(state, 'waitlist_signup_error', (h) => h['ep.error_code'] === 'unavailable');
            check(events(state, 'waitlist_request_accepted').length === 0, 'request_accepted sent for a failed signup');
            const cookies = await page.context().cookies();
            check(!cookies.some((c) => c.name.startsWith('_ga')), `denied consent but GA cookies set: ${cookies.map((c) => c.name)}`);
        },
    },
    {
        name: 'home-analytics-blocked',
        consent: 'granted',
        blockGtag: true,
        path: '/',
        waitlist: { '/waitlist/subscribe': subscribeOk },
        async run(page, state) {
            await page.locator('#stateGrid .state-card').first().waitFor();
            await page.fill('#searchInput', 'cafe');
            await page.locator('#searchResults .coffee-item').first().waitFor();
            await page.locator('#waitlist-email-home').fill(QA_EMAIL);
            await page.locator('#waitlist-consent-home').check();
            await page.locator('#waitlist-home .waitlist-submit').click();
            await page.locator('#waitlist-home .waitlist-success').waitFor({ state: 'visible' });
            await page.waitForTimeout(3000);
            check(state.collect.length === 0, `collect requests sent with gtag blocked: ${state.collect.length}`);
            check(state.gtagLoads === 0, 'gtag.js loaded although blocked');
        },
    },
    {
        name: 'roasters-filter-click-and-provider-error',
        consent: 'granted',
        path: `/roasters/?q=${encodeURIComponent(QA_ROASTER_SEARCH)}&state=MA`,
        waitlist: { '/waitlist/subscribe': err(502, 'WAITLIST_PROVIDER_ERROR') },
        async run(page, state) {
            const pageView = await waitForEvent(state, 'page_view');
            check(!/[?&]q=/.test(pageView.dl) && pageView.dl.includes('state=MA'), `roasters page_view dl ${pageView.dl}`);
            check(!/[?&]q=/.test(await addressBar(page)), 'address bar still has ?q=');
            check(await page.locator('#roasterSearch').inputValue() === QA_ROASTER_SEARCH, 'deep-linked roaster query missing');
            await page.fill('#roasterSearch', '');
            await page.locator('#roasterSearch').type(QA_ROASTER_SEARCH, { delay: 30 });
            await page.fill('#roasterSearch', 'coffee');
            const filterHit = await waitForEvent(state, 'roaster_filter');
            check(filterHit['ep.filter_has_query'] === 'yes' && filterHit['ep.filter_state'] === 'MA', `roaster_filter params ${JSON.stringify(filterHit)}`);
            check(!/[?&]q=/.test(await addressBar(page)), 'roaster search text written to the URL');

            await page.selectOption('#roasterState', '');
            await page.fill('#roasterSearch', '');
            // Keep the click on this page: a later window listener cancels navigation.
            await page.evaluate(() => window.addEventListener('click', (e) => { if (e.target.closest('a')) e.preventDefault(); }));
            const shop = page.locator('.roaster-card:not([hidden]) a.roaster-shop').first();
            const roasterId = (await shop.evaluate((a) => a.closest('.roaster-card').id)).replace(/^roaster-/, '');
            await shop.click();
            // ONE canonical bean-store click: GA enhanced outbound `click`,
            // filtered by link_classes=roaster-shop + the catalog merchant URL.
            const shopUrl = await shop.getAttribute('href');
            check(ROASTERS.find((r) => r.id === roasterId)?.shopUrl === shopUrl, `link ${shopUrl} is not the catalog shopUrl for ${roasterId}`);
            const click = await waitForEvent(state, 'click', (h) => h['ep.link_classes'] === 'roaster-shop');
            check(click['ep.outbound'] === 'true' && click['ep.link_url'] === shopUrl, `outbound click params ${JSON.stringify(click)}`);
            await page.waitForTimeout(2500);
            check(events(state, 'click').filter((h) => h['ep.link_classes'] === 'roaster-shop' && h['ep.link_url'] === shopUrl).length === 1, `canonical outbound click counted ${events(state, 'click').length} times for one click`);
            check(events(state, 'click').length === 1, `unexpected extra click events: ${JSON.stringify(events(state, 'click').map((h) => h['ep.link_classes']))}`);
            check(events(state, 'bean_store_click').length === 0, 'competing custom bean_store_click was sent');

            await page.locator('#waitlist-email-roasters').fill(QA_EMAIL);
            await page.locator('#waitlist-consent-roasters').check();
            await page.locator('#waitlist-roasters .waitlist-submit').click();
            const alert = page.locator('#waitlist-roasters .waitlist-alert');
            await alert.waitFor({ state: 'visible' });
            check(/couldn.t send/i.test(await alert.textContent()), 'provider error alert text');
            check(state.waitlistRequests[0].body.source === 'roasters', 'roasters source not sent');
            await waitForEvent(state, 'waitlist_signup_error', (h) => h['ep.error_code'] === 'provider' && h['ep.waitlist_source'] === 'roasters');
        },
    },
    {
        name: 'confirm-explicit-post-then-replay',
        consent: 'granted',
        path: `/waitlist/confirm/#token=${QA_TOKEN}`,
        waitlist: {
            '/waitlist/confirm': (state) => (state.confirmCalls = (state.confirmCalls || 0) + 1) === 1
                ? ok({ status: 'confirmed', conversion: 'observed_new' }) : ok({ status: 'already_confirmed', conversion: 'none' }),
        },
        async run(page, state) {
            const pageView = await waitForEvent(state, 'page_view');
            check(!pageView.dl.includes('#') && !pageView.dl.includes('token'), `confirm page_view dl ${pageView.dl}`);
            check(!(await addressBar(page)).includes('token'), 'token still in the address bar');
            await page.waitForTimeout(1500);
            check(state.waitlistRequests.length === 0, 'confirm POSTed on page load (scanner-unsafe)');
            check(events(state, 'waitlist_confirmed').length === 0, 'waitlist_confirmed on page visit');
            await page.getByRole('button', { name: 'Confirm my interest' }).click();
            const status = page.locator('[data-status]');
            await waitUntil(async () => /on the interest list/i.test(await status.textContent()), { message: 'confirmed status' });
            check(await page.evaluate(() => document.activeElement.hasAttribute('data-status')), 'focus not on the status message after the button was hidden');
            check(state.waitlistRequests.length === 1 && state.waitlistRequests[0].body.token === QA_TOKEN, `confirm request ${JSON.stringify(state.waitlistRequests)}`);
            await waitForEvent(state, 'waitlist_confirmed', (h) => h['ep.confirm_result'] === 'confirmed');

            // Replay: same link again in a new load.
            const before = events(state, 'waitlist_confirmed').length;
            // Via about:blank: the address bar is /waitlist/confirm/ already, so a
            // direct goto would be a same-document fragment change, not a load.
            await page.goto('about:blank');
            await page.goto(`${ORIGIN}/waitlist/confirm/#token=${QA_TOKEN}`);
            await page.getByRole('button', { name: 'Confirm my interest' }).click();
            await waitUntil(async () => /already on the interest list/i.test(await page.locator('[data-status]').textContent()), { message: 'already_confirmed status' });
            await page.waitForTimeout(3000);
            check(events(state, 'waitlist_confirmed').length === before, 'replay counted as a new confirmation');
        },
    },
    {
        name: 'confirm-ambiguous-not-counted',
        consent: 'granted',
        path: `/waitlist/confirm/#token=${QA_TOKEN}`,
        waitlist: { '/waitlist/confirm': ok({ status: 'confirmed', conversion: 'ambiguous' }) },
        async run(page, state) {
            await page.getByRole('button', { name: 'Confirm my interest' }).click();
            await waitUntil(async () => /on the interest list/i.test(await page.locator('[data-status]').textContent()), { message: 'confirmed status' });
            await page.waitForTimeout(3000);
            check(events(state, 'waitlist_confirmed').length === 0, 'ambiguous confirmation counted as a conversion');
        },
    },
    {
        name: 'confirm-invalid-token',
        consent: 'granted',
        path: `/waitlist/confirm/#token=${QA_TOKEN}`,
        waitlist: { '/waitlist/confirm': err(400, 'WAITLIST_TOKEN_INVALID') },
        async run(page, state) {
            await page.getByRole('button', { name: 'Confirm my interest' }).click();
            const alert = page.locator('[data-alert]');
            await alert.waitFor({ state: 'visible' });
            check(/isn.t valid/i.test(await alert.textContent()), 'invalid token alert');
            check(await page.evaluate(() => document.activeElement.hasAttribute('data-alert')), 'focus not on the alert after the button was hidden');
            await page.waitForTimeout(2500);
            check(events(state, 'waitlist_confirmed').length === 0, 'confirmed event for an invalid token');
        },
    },
    {
        name: 'confirm-suppressed',
        consent: 'granted',
        path: `/waitlist/confirm/#token=${QA_TOKEN}`,
        waitlist: { '/waitlist/confirm': ok({ status: 'suppressed', conversion: 'none' }) },
        async run(page, state) {
            await page.getByRole('button', { name: 'Confirm my interest' }).click();
            await waitUntil(async () => /unsubscribed from the roaster interest list/i.test(await page.locator('[data-status]').textContent()), { message: 'suppressed status' });
            check(await page.locator('[data-alert]').isHidden(), 'suppressed shown as an error');
            check(await page.locator('[data-status] a[href="/pages/contact.html"]').count() === 1, 'suppressed has no contact link');
            check(await page.evaluate(() => document.activeElement.hasAttribute('data-status')), 'focus not on the status message');
            await page.waitForTimeout(2500);
            check(events(state, 'waitlist_confirmed').length === 0, 'suppressed counted as a confirmation');
        },
    },
    {
        // The real regression: a same-origin referrer that carries ?q= and an email.
        name: 'home-dirty-referrer',
        consent: 'granted',
        path: '/',
        referer: QA_DIRTY_REFERRER,
        async run(page, state) {
            check((await page.evaluate(() => document.referrer)).includes('QA_PRIVATE_REFERRER'), 'regression setup: document.referrer is not dirty');
            const pageView = await waitForEvent(state, 'page_view');
            check(!pageView.dr || new URL(pageView.dr).search === '', `page_view dr leaked a query: ${pageView.dr}`);
            check(!pageView.dl.includes('?'), `page_view dl=${pageView.dl}`);
            await page.locator('#stateGrid .state-card').first().waitFor();
            await page.fill('#searchInput', 'Bean');
            await waitForEvent(state, 'directory_search');
            for (const h of hitsOf(state)) check(!h.dr || new URL(h.dr).search === '', `en=${h.en} dr leaked a query: ${h.dr}`);
        },
    },
    {
        // Every other GA page, opened directly with search / email / token in the URL.
        name: 'direct-pages-dirty-query',
        consent: 'granted',
        path: 'about:blank',
        async run(page, state) {
            const pages = ['/html/state.html?code=CA', '/html/about.html?', '/html/404.html?', '/html/submit.html?', '/waitlist/unsubscribe/?'];
            for (const entry of pages) {
                const url = `${ORIGIN}${entry}${entry.endsWith('?') ? '' : '&'}${QA_DIRTY_QUERY}`;
                const path = entry.split('?')[0];
                await page.goto('about:blank');
                const before = hitsOf(state).length;
                await page.goto(url);
                await checkConfig(page, state);
                const pageView = await waitUntil(() => hitsOf(state).slice(before).find((h) => h.en === 'page_view'), { message: `page_view on ${path}` });
                check(pageView.dl.includes(path) && !/[?&](q|email|token)=/i.test(pageView.dl), `${path} page_view dl=${pageView.dl}`);
                check(!pageView.dr, `${path} page_view dr=${pageView.dr}`);
                check(!/[?&](q|email|token)=/i.test(await addressBar(page)), `${path} address bar still dirty: ${await addressBar(page)}`);
            }
            // A page with no Google tag at all has none of it: no tag, no dataLayer, and
            // no hit that describes it (hits flushed from the previous page on unload don't count).
            await page.goto('about:blank');
            await page.waitForTimeout(1500);
            const loadsBefore = state.gtagLoads;
            await page.goto(`${ORIGIN}/pages/privacy.html?${QA_DIRTY_QUERY}`);
            await page.waitForTimeout(2500);
            check(state.gtagLoads === loadsBefore, 'privacy page loaded gtag.js');
            check(await page.evaluate(() => !window.gtag && !window.dataLayer && !window.LcsUrlPrivacy), 'privacy page has Google tag pieces');
            check(!hitsOf(state).some((h) => (h.dl || '').includes('/pages/privacy.html')), 'a hit describes the privacy page');
        },
    },
    {
        // Helper blocked: fail closed. The tag script may load, but is never configured: nothing is sent.
        name: 'helper-blocked-fails-closed',
        consent: 'granted',
        blockPaths: ['/url-privacy.js'],
        path: `/html/about.html?${QA_DIRTY_QUERY}`,
        referer: QA_DIRTY_REFERRER,
        async run(page, state) {
            await page.waitForTimeout(3500);
            check(state.blockedLocal.includes('/url-privacy.js'), 'url-privacy.js was not blocked');
            check(await page.evaluate(() => window['ga-disable-G-YVSXN7PM48'] === true), 'ga-disable flag not set');
            check(await page.evaluate(() => !window.dataLayer.some((a) => a[0] === 'config' || a[0] === 'js')), 'tag was configured without the privacy helper');
            check(state.collect.length === 0, `collect requests with the helper blocked: ${state.collect.length}`);
        },
    },
    {
        // Consent helper blocked: analytics-init falls back to denied defaults.
        name: 'consent-helper-blocked-defaults-denied',
        blockPaths: ['/geo-consent-default.js'],
        path: '/',
        async run(page, state) {
            const pageView = await waitForEvent(state, 'page_view');
            check(pageView.gcs === 'G100', `consent helper blocked: page_view gcs=${pageView.gcs} (expected denied G100)`);
            await page.waitForTimeout(1500);
            const cookies = await page.context().cookies();
            check(!cookies.some((c) => c.name.startsWith('_ga')), `GA cookies set with denied defaults: ${cookies.map((c) => c.name)}`);
        },
    },
    {
        // Strict region, no saved choice: analytics denied by default (cookieless, no _ga cookie), banner offered.
        name: 'strict-region-default-denied',
        timezone: 'Europe/Paris',
        locale: 'fr-FR',
        path: '/',
        async run(page, state) {
            const pageView = await waitForEvent(state, 'page_view');
            check(pageView.gcs === 'G100', `strict default page_view gcs=${pageView.gcs}`);
            await page.locator('#consent-banner.consent-banner-visible').waitFor({ timeout: 5000 });
            await page.waitForTimeout(1500);
            const cookies = await page.context().cookies();
            check(!cookies.some((c) => c.name.startsWith('_ga')), `strict default but GA cookies set: ${cookies.map((c) => c.name)}`);
            check(!(await page.evaluate(() => window.dataLayer.some((a) => a[0] === 'set' && a[1] === 'url_passthrough'))), 'url_passthrough enabled');
        },
    },
    {
        // Live reject: granted by default (non-strict), then Reject All; later hits are denied.
        name: 'live-reject-after-default-grant',
        path: '/',
        async run(page, state) {
            const first = await waitForEvent(state, 'page_view');
            check(first.gcs === 'G101', `default (non-strict: analytics granted, ads denied) page_view gcs=${first.gcs}`);
            await page.locator('#consent-banner.consent-banner-visible').waitFor({ timeout: 5000 });
            await page.locator('#consent-reject').click();
            await page.locator('#stateGrid .state-card').first().waitFor();
            await page.fill('#searchInput', 'Bean');
            const search = await waitForEvent(state, 'directory_search');
            check(search.gcs === 'G100', `after live Reject All, directory_search gcs=${search.gcs} (expected G100)`);
            const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cookie_consent')).consent.analytics_storage);
            check(saved === 'denied', 'reject not persisted');
        },
    },
    {
        // gtag mostly uses fetch(keepalive); prove the default-deny route also
        // captures sendBeacon / image pings to every Google collection host.
        name: 'collect-interception-selfcheck',
        consent: 'denied',
        blockGtag: true,
        path: '/waitlist/unsubscribe/',
        async run(page, state) {
            const targets = [
                'https://region1.google-analytics.com/g/collect?v=2&en=qa_beacon',
                'https://www.google.com/g/collect?v=2&en=qa_beacon',
                'https://stats.g.doubleclick.net/g/collect?v=2&en=qa_beacon',
            ];
            const queued = await page.evaluate((urls) => urls.map((u) => navigator.sendBeacon(u, 'en=qa_beacon_body')), targets);
            check(queued.every(Boolean), 'sendBeacon refused to queue');
            await page.evaluate(() => { new Image().src = 'https://www.google-analytics.com/collect?v=1&t=pageview'; });
            await waitUntil(() => state.collect.length >= 4, { timeout: 10000, message: 'beacon/image interception' });
            const hosts = state.collect.map((c) => new URL(c.url).hostname).sort();
            check(JSON.stringify(hosts) === JSON.stringify(['region1.google-analytics.com', 'stats.g.doubleclick.net', 'www.google-analytics.com', 'www.google.com']), `intercepted hosts ${hosts}`);
            check(state.collect.filter((c) => c.postData === 'en=qa_beacon_body').length === 3, 'beacon bodies not captured');
        },
    },
    {
        name: 'unsubscribe-explicit-post',
        consent: 'denied',
        path: `/waitlist/unsubscribe/#token=${QA_TOKEN}`,
        waitlist: { '/waitlist/unsubscribe': ok({ status: 'unsubscribed' }) },
        async run(page, state) {
            await page.waitForTimeout(1000);
            check(state.waitlistRequests.length === 0, 'unsubscribe POSTed on page load');
            check(!(await addressBar(page)).includes('token'), 'token still in the address bar');
            await page.getByRole('button', { name: 'Unsubscribe' }).focus();
            await page.keyboard.press('Enter');
            await waitUntil(async () => /unsubscribed/i.test(await page.locator('[data-status]').textContent()), { message: 'unsubscribed status' });
            check(state.waitlistRequests[0].body.token === QA_TOKEN, 'unsubscribe body');
        },
    },
];

const VIEWPORTS = {
    desktop: { viewport: { width: 1280, height: 800 } },
    mobile: { ...devices['Pixel 7'] },
};

const MODES = process.env.QA_MODES
    ? process.env.QA_MODES.split(',').map((m) => m.trim()).filter(Boolean)
    : Object.keys(CONFIG_FIXTURES);

function newState(scenario, config) {
    return {
        config,
        collect: [], blocked: [], blockedLocal: [], unexpected: [], waitlistRequests: [], apiOrigins: new Set(), gtagLoads: 0,
        waitlist: scenario.waitlist || {}, blockGtag: !!scenario.blockGtag,
        blockPaths: scenario.blockPaths ? new Set(scenario.blockPaths) : null,
    };
}

function eventCounts(state) {
    const counts = {};
    for (const h of hitsOf(state)) counts[h.en] = (counts[h.en] || 0) + 1;
    return counts;
}

async function main() {
    const before = trackedSnapshot();
    const server = await startServer();
    const browser = await chromium.launch();
    const failures = [];
    const evidence = [];
    let passed = 0;
    try {
        if (OUT_DIR) await mkdir(OUT_DIR, { recursive: true });
        for (const mode of MODES) {
            const config = CONFIG_FIXTURES[mode];
            if (!config) throw new Error(`unknown QA mode ${mode}; expected one of ${Object.keys(CONFIG_FIXTURES)}`);
            if (OUT_DIR) await mkdir(join(OUT_DIR, mode), { recursive: true });
            for (const [viewportName, contextOptions] of Object.entries(VIEWPORTS)) {
                for (const scenario of SCENARIOS) {
                    if (process.env.QA_ONLY && !scenario.name.includes(process.env.QA_ONLY)) continue;
                    const label = `${mode}/${viewportName}/${scenario.name}`;
                    const context = await browser.newContext({
                        ...contextOptions,
                        serviceWorkers: 'block',
                        locale: scenario.locale || 'en-US',
                        timezoneId: scenario.timezone || 'America/New_York',
                    });
                    const state = newState(scenario, config);
                    // Default-deny routing and init scripts are in place before the first navigation.
                    await installRoutes(context, state);
                    await context.addInitScript(BEACON_SPY);
                    const init = consentInit(scenario.consent);
                    if (init) await context.addInitScript(init);
                    const page = await context.newPage();
                    const pageErrors = [];
                    page.on('pageerror', (e) => pageErrors.push(e.message));
                    let spy = [];
                    try {
                        await page.goto(scenario.path === 'about:blank' ? scenario.path : ORIGIN + scenario.path, scenario.referer ? { referer: scenario.referer } : undefined);
                        if (scenario.path !== 'about:blank') await checkConfig(page, state);
                        await scenario.run(page, state);
                        await noHorizontalOverflow(page);
                        spy = await page.evaluate(() => window.__gaSpy || []);
                        const leaks = [
                            ...state.collect.flatMap((c) => scanForbidden(`${c.url}\n${c.postData}`).map((n) => `${n} in ${c.url.slice(0, 80)}`)),
                            ...spy.flatMap((x) => scanForbidden(`${x.url}\n${x.body}`).map((n) => `${n} in spied ${x.kind}`)),
                            ...state.blocked.flatMap((b) => scanForbidden(b).map((n) => `${n} in blocked ${b.split('\n')[0].slice(0, 80)}`)),
                        ];
                        check(leaks.length === 0, `PII/raw text in Google requests: ${[...new Set(leaks)].join('; ')}`);
                        check(state.collect.every((c) => !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(c.url)), 'collect sent to local origin');
                        check([...state.apiOrigins].every((o) => o === config.apiOrigin)
                            && state.waitlistRequests.every((r) => r.origin === config.apiOrigin), `API request outside the ${mode} origin ${config.apiOrigin}`);
                        check(pageErrors.length === 0, `uncaught page errors: ${pageErrors.join('; ')}`);
                        check(state.unexpected.length === 0, state.unexpected.join('; '));
                        passed++;
                        console.log(`✓ ${label} (${state.collect.length} GA requests intercepted, ${hitsOf(state).length} hits, gtag.js loads ${state.gtagLoads})`);
                    } catch (e) {
                        failures.push(`${label}: ${e.message}`);
                        console.log(`✗ ${label}: ${e.message}`);
                    } finally {
                        if (OUT_DIR) {
                            await page.screenshot({ path: join(OUT_DIR, mode, `${viewportName}-${scenario.name}.png`), fullPage: true }).catch(() => {});
                        }
                        evidence.push({
                            scenario: label,
                            mode,
                            config: { apiBase: config.apiBase, environment: config.environment },
                            consent: scenario.consent || 'none',
                            gtagBlocked: !!scenario.blockGtag,
                            blockedLocalPaths: [...new Set(state.blockedLocal)],
                            gtagLoads: state.gtagLoads,
                            eventCounts: eventCounts(state),
                            collectRequests: state.collect.map((c) => ({ host: new URL(c.url).hostname, path: new URL(c.url).pathname, method: c.method, resourceType: c.resourceType })),
                            hits: hitsOf(state).map((h) => Object.fromEntries(Object.entries(h).filter(([k]) => /^(en|tid|gcs|dl|dr|dt|_host|_path)$|^ep\.|^epn\./.test(k)))),
                            spiedTransport: spy.map((x) => x.kind),
                            blockedGoogleRequests: [...new Set(state.blocked.map((b) => b.split('\n')[0]))],
                            apiOrigins: [...state.apiOrigins],
                            waitlistRequests: state.waitlistRequests.map((r) => ({ method: r.method, path: r.path, origin: r.origin, bodyKeys: r.body ? Object.keys(r.body) : [] })),
                            unexpected: state.unexpected,
                        });
                        await context.close();
                    }
                }
            }
        }
    } finally {
        await browser.close();
        server.close();
    }

    const after = trackedSnapshot();
    if (after.status !== before.status || after.configSha256 !== before.configSha256) {
        failures.push('tracked files changed during QA (git status or public/config.js hash differs)');
    }
    const summary = {
        ranAt: new Date().toISOString(),
        modes: MODES,
        passed,
        failed: failures.length,
        failures,
        trackedFiles: { unchanged: after.status === before.status && after.configSha256 === before.configSha256, configSha256: after.configSha256 },
        configFixturesServedFromMemory: Object.fromEntries(MODES.map((m) => [m, CONFIG_FIXTURES[m].js])),
        forbiddenStrings: FORBIDDEN,
    };
    if (OUT_DIR) {
        await writeFile(join(OUT_DIR, 'waitlist-qa-evidence.json'), JSON.stringify({ summary, evidence }, null, 2));
    }
    console.log(`\n${passed} passed, ${failures.length} failed (modes: ${MODES.join(', ')}); tracked files unchanged: ${summary.trackedFiles.unchanged}`);
    if (failures.length) process.exitCode = 1;
}

export { parseHits, scanForbidden, isCollect, installRoutes, configMismatch, checkConfig, CONFIG_FIXTURES, FORBIDDEN, SCENARIOS, ORIGIN, PORT };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch((e) => {
        console.error(e);
        process.exitCode = 1;
    });
}
