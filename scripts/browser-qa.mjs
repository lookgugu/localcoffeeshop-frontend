#!/usr/bin/env node
/**
 * Local browser QA for the discovery pages (homepage + interactive state page).
 *
 *   npm run build:js && npm run build:css   # bundles the pages load
 *   npm run qa:browser                      # QA_OUT_DIR=<dir> to keep screenshots
 *
 * Serves public/ on 127.0.0.1:8187 with a tiny built-in static server (fails
 * fast if the port is taken rather than testing someone else's server) and
 * drives Chromium via Playwright at desktop and mobile sizes.
 *
 * Nothing leaves the machine: the API (production URL or /api/v1) is mocked
 * per scenario inside the browser, Google Analytics and every other
 * non-local request is aborted, service workers are blocked, and no form is
 * ever submitted. Any unexpected outbound request fails the run.
 */

import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const PORT = 8187;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT_DIR = process.env.QA_OUT_DIR || null;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.xml': 'application/xml',
    '.txt': 'text/plain',
};

// The pages as deployed: build:html copies public/html/*.html to public/.
const PAGE_ALIASES = { '/': '/html/index.html', '/index.html': '/html/index.html' };

function startServer() {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, ORIGIN);
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405).end();
            return;
        }
        let pathname = PAGE_ALIASES[url.pathname] || url.pathname;
        if (pathname.endsWith('/')) pathname += 'index.html';
        const file = normalize(join(PUBLIC, pathname));
        if (!file.startsWith(PUBLIC)) {
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
            ? new Error(`Port ${PORT} is already in use; stop whatever is on it (browser QA owns ${PORT}).`)
            : err));
        server.listen(PORT, '127.0.0.1', () => resolvePromise(server));
    });
}

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------

const STATES = [
    { state_code: 'CA', shop_count: 3, avg_price_level: 2.1 },
    { state_code: 'TX', shop_count: 2, avg_price_level: 1.6 },
];
const SHOPS = [
    { id: 1, displayName: { text: 'Alpha Cafe' }, formattedAddress: '1 Market St, San Francisco, CA 94105, USA', state: 'CA', priceLevel: 'PRICE_LEVEL_MODERATE', websiteUri: 'https://alpha.example/' },
    { id: 2, displayName: { text: 'Beta "Beans" & Co' }, formattedAddress: '2 Mission St, San Francisco, CA', state: 'CA', priceLevel: 'PRICE_LEVEL_INEXPENSIVE', websiteUri: 'javascript:alert(1)' },
    { id: 3, displayName: { text: 'Gamma Roasters' }, state: 'CA' },
];

const ok = (data, metadata) => ({ status: 200, body: { success: true, data, ...(metadata ? { metadata } : {}) } });

/** Scenario API: (path, url) -> { status, body } | 'network-error'. */
const HEALTHY = (path) => {
    if (path === '/health') return ok({ status: 'ok' });
    if (path === '/config') return ok({ frontendUrl: ORIGIN });
    if (path === '/states') return ok(STATES);
    if (path === '/search' || path.startsWith('/states/')) {
        return ok(SHOPS, { pagination: { page: 1, limit: 100, total: SHOPS.length, hasNext: false } });
    }
    return { status: 404, body: { success: false, error: { message: 'not mocked' } } };
};
const failingStates = (status) => (path, url) => (path === '/states' ? { status, body: { success: false } } : HEALTHY(path, url));

async function installRoutes(page, state, unexpected) {
    // Deterministic config: always point at the production API URL, which is mocked below.
    await page.route(`${ORIGIN}/config.js`, (route) => route.fulfill({
        contentType: 'application/javascript',
        body: "window.APP_CONFIG = { API_BASE_URL: 'https://api.localcoffeeshop.co/api/v1', ENVIRONMENT: 'qa' };",
    }));
    await page.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const apiMatch = url.pathname.match(/\/api\/v1(\/.*)$/);
        const isApiHost = url.origin === 'https://api.localcoffeeshop.co' || (url.origin === ORIGIN && apiMatch);
        if (isApiHost && apiMatch) {
            if (request.method() !== 'GET') {
                unexpected.push(`non-GET API request: ${request.method()} ${url}`);
                return route.abort();
            }
            const result = state.api(apiMatch[1], url);
            if (result === 'network-error') return route.abort('internetdisconnected');
            return route.fulfill({ status: result.status, contentType: 'application/json', body: JSON.stringify(result.body) });
        }
        if (url.origin === ORIGIN) return route.continue();
        // Analytics, fonts, anything else external: never sent.
        if (!/googletagmanager|google-analytics|doubleclick|fonts\.g/.test(url.hostname)) {
            unexpected.push(`unexpected external request: ${request.method()} ${url}`);
        }
        return route.abort();
    });
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function check(condition, message) {
    if (!condition) throw new Error(message);
}

async function noHorizontalOverflow(page) {
    const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
    check(scroll <= width + 1, `page scrolls horizontally (${scroll}px wide in a ${width}px viewport)`);
}

async function checkActionLinks(page, scope) {
    const links = await page.$$eval(`${scope} a.shop-action`, (as) => as.map((a) => ({
        cls: a.className, href: a.getAttribute('href'), target: a.getAttribute('target'),
        rel: a.getAttribute('rel'), label: a.getAttribute('aria-label'),
        height: a.getBoundingClientRect().height,
    })));
    const directions = links.filter((l) => l.cls.includes('directions'));
    const websites = links.filter((l) => l.cls.includes('website'));
    check(directions.length === 2, `expected 2 Directions links (shops with an address), got ${directions.length}`);
    check(websites.length === 1 && websites[0].href === 'https://alpha.example/', `expected only the safe website link, got ${JSON.stringify(websites.map((w) => w.href))}`);
    for (const l of links) {
        check(l.target === null, `action link has target=${l.target}`);
        check(/noopener/.test(l.rel) && /noreferrer/.test(l.rel), `action link rel is "${l.rel}"`);
        check(l.label && l.label.length > 0, 'action link without aria-label');
        check(/^https:\/\//.test(l.href), `action link href is not https: ${l.href}`);
        check(l.height >= 44, `action link touch target is ${l.height}px tall (< 44px)`);
    }
    const dest = new URL(directions[0].href).searchParams.get('destination');
    check(dest === 'Alpha Cafe, 1 Market St, San Francisco, CA 94105, USA', `directions destination was "${dest}"`);
}

async function checkNotice(page) {
    const notice = page.locator('.coverage-notice');
    check(await notice.isVisible(), 'coverage notice not visible');
    check(await notice.locator('a[href="/submit.html"]').count() === 1, 'coverage notice has no correction link');
}

const SCENARIOS = [
    {
        name: 'homepage-healthy-search',
        path: '/',
        api: HEALTHY,
        async run(page) {
            await page.locator('#stateGrid .state-card').first().waitFor();
            check(await page.locator('#stateGrid .state-card').count() === STATES.length, 'state grid card count');
            await checkNotice(page);
            await page.fill('#searchInput', 'cafe');
            await page.locator('#searchResults .coffee-item').first().waitFor();
            await checkActionLinks(page, '#searchResults');
            check(await page.locator('#searchInput').isEnabled(), 'search input disabled on a healthy page');
        },
    },
    {
        name: 'homepage-server-error-then-retry',
        path: '/',
        api: failingStates(503),
        async run(page, state) {
            const message = page.locator('#serverStatusMessage');
            await message.waitFor({ timeout: 10000 });
            check(/HTTP 503/.test(await message.textContent()), 'server-error message lacks the status');
            for (const id of ['searchInput', 'stateFilter', 'priceFilter']) {
                check(await page.locator(`#${id}`).isDisabled(), `#${id} still enabled while the API is down`);
                check(await page.locator(`#${id}`).getAttribute('aria-disabled') === 'true', `#${id} lacks aria-disabled`);
            }
            check(await page.locator('#serverStatus a[href="/pages/states/"]').count() === 1, 'no static directory fallback link');
            state.api = HEALTHY; // API recovers
            await page.getByRole('button', { name: 'Try again' }).click();
            await page.locator('#stateGrid .state-card').first().waitFor({ timeout: 10000 });
            check(await page.locator('#searchInput').isEnabled(), 'search input not re-enabled after retry');
            check(!(await page.locator('#serverStatus').isVisible()), 'status still visible after a successful retry');
            check(await page.locator('#stateFilter option').count() === STATES.length + 1, 'duplicate or missing state options after retry');
        },
    },
    {
        name: 'homepage-rate-limited',
        path: '/',
        api: failingStates(429),
        async run(page) {
            const message = page.locator('#serverStatusMessage');
            await message.waitFor({ timeout: 10000 });
            const text = await message.textContent();
            check(/too many requests/i.test(text) && !/offline|HTTP 5/.test(text), `rate-limit message was "${text}"`);
        },
    },
    {
        name: 'homepage-network-error',
        path: '/',
        api: () => 'network-error',
        async run(page) {
            const message = page.locator('#serverStatusMessage');
            await message.waitFor({ timeout: 10000 });
            check(/couldn.t reach/i.test(await message.textContent()), 'network-error message');
        },
    },
    {
        name: 'state-page',
        path: '/html/state.html?code=CA',
        api: HEALTHY,
        async run(page) {
            await page.locator('#coffeeList .coffee-item h3').first().waitFor();
            await checkNotice(page);
            await checkActionLinks(page, '#coffeeList');
        },
    },
];

const VIEWPORTS = {
    desktop: { viewport: { width: 1280, height: 800 } },
    mobile: { ...devices['Pixel 7'] },
};

async function main() {
    const server = await startServer();
    const browser = await chromium.launch();
    const failures = [];
    let passed = 0;
    try {
        if (OUT_DIR) await mkdir(OUT_DIR, { recursive: true });
        for (const [viewportName, contextOptions] of Object.entries(VIEWPORTS)) {
            for (const scenario of SCENARIOS) {
                const label = `${viewportName}/${scenario.name}`;
                const context = await browser.newContext({ ...contextOptions, serviceWorkers: 'block' });
                const page = await context.newPage();
                const unexpected = [];
                const pageErrors = [];
                page.on('pageerror', (err) => pageErrors.push(err.message));
                const state = { api: scenario.api };
                await installRoutes(page, state, unexpected);
                try {
                    await page.goto(ORIGIN + scenario.path);
                    await scenario.run(page, state);
                    await noHorizontalOverflow(page);
                    check(pageErrors.length === 0, `uncaught page errors: ${pageErrors.join('; ')}`);
                    check(unexpected.length === 0, unexpected.join('; '));
                    passed++;
                    console.log(`✓ ${label}`);
                } catch (err) {
                    failures.push(`${label}: ${err.message}`);
                    console.log(`✗ ${label}: ${err.message}`);
                } finally {
                    if (OUT_DIR) await page.screenshot({ path: join(OUT_DIR, `${viewportName}-${scenario.name}.png`), fullPage: true });
                    await context.close();
                }
            }
        }
    } finally {
        await browser.close();
        server.close();
    }
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
