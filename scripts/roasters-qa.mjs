#!/usr/bin/env node
/**
 * Local browser QA for the roaster directory (/roasters/, #50).
 *
 *   npm run build:css && npm run build:roasters   # page + stylesheet it loads
 *   npm run qa:roasters                           # QA_OUT_DIR=<dir> to keep screenshots
 *
 * Serves public/ on 127.0.0.1:8188 (GET/HEAD only; its own port, so it can't
 * collide with scripts/browser-qa.mjs on 8187) and drives Chromium at desktop
 * and mobile sizes, with JavaScript on and off.
 *
 * Nothing leaves the machine: every non-local request is aborted (Google
 * Analytics is expected and only counted; anything else fails the run),
 * service workers are blocked, no form is submitted and no outbound link is
 * clicked: links are checked by their href only.
 */

import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const PORT = 8188;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT_DIR = process.env.QA_OUT_DIR || null;
const DATA = JSON.parse(readFileSync(join(ROOT, 'data/roasters.json'), 'utf8')).roasters;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
};
const PAGE_ALIASES = { '/': '/html/index.html' };

function startServer() {
    const server = http.createServer(async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405).end();
            return;
        }
        let pathname = PAGE_ALIASES[new URL(req.url, ORIGIN).pathname] || new URL(req.url, ORIGIN).pathname;
        if (pathname.endsWith('/')) pathname += 'index.html';
        const file = normalize(join(PUBLIC, decodeURIComponent(pathname)));
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
            ? new Error(`Port ${PORT} is already in use; stop whatever is on it (roaster QA owns ${PORT}).`)
            : err));
        server.listen(PORT, '127.0.0.1', () => resolvePromise(server));
    });
}

const isAnalytics = (host) => /googletagmanager|google-analytics|doubleclick|(^|\.)google\.com$/.test(host);

async function guard(page, log) {
    await page.route('**/*', (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.origin === ORIGIN) {
            if (req.method() !== 'GET' && req.method() !== 'HEAD') {
                log.unexpected.push(`non-GET local request: ${req.method()} ${url}`);
                return route.abort();
            }
            return route.continue();
        }
        if (isAnalytics(url.hostname)) log.analyticsBlocked++;
        else log.unexpected.push(`external request: ${req.method()} ${url}`);
        return route.abort();
    });
    page.on('console', (msg) => {
        // Aborted analytics requests log a load failure; anything else is real.
        if (msg.type() === 'error' && !/Failed to load resource: net::ERR_FAILED/.test(msg.text())) {
            log.consoleErrors.push(msg.text());
        }
    });
    page.on('pageerror', (err) => log.consoleErrors.push(String(err)));
}

const checks = [];
function check(label, ok, detail = '') {
    checks.push({ label, ok: Boolean(ok), detail });
}

const visibleCards = (page) => page.locator('.roaster-card:visible');
const count = (pred) => DATA.filter(pred).length;
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function jsScenario(browser, name, contextOptions) {
    const log = { unexpected: [], consoleErrors: [], analyticsBlocked: 0 };
    const context = await browser.newContext({ ...contextOptions, serviceWorkers: 'block' });
    const page = await context.newPage();
    await guard(page, log);
    const p = (label) => `[${name}] ${label}`;

    await page.goto(`${ORIGIN}/roasters/`, { waitUntil: 'load' });
    check(p('all roasters listed'), (await visibleCards(page).count()) === DATA.length, `${await visibleCards(page).count()} of ${DATA.length}`);
    check(p('filters revealed by JS'), await page.locator('#roasterFilters').isVisible());
    check(p('initial status'), (await page.locator('#roasterStatus').textContent()) === `Showing all ${DATA.length} roasters.`);
    check(p('consent banner rendered'), (await page.locator('#consent-banner').count()) === 1);

    // Search by city (keyboard typing into the labelled field)
    await page.getByLabel('Search by name or city').fill('');
    await page.getByLabel('Search by name or city').pressSequentially('portland');
    const portland = count((r) => norm(r.city).includes('portland') || norm(r.name).includes('portland'));
    check(p('search "portland"'), (await visibleCards(page).count()) === portland, `${await visibleCards(page).count()} vs ${portland}`);
    check(p('search announced'), /Showing \d+ of \d+ roasters matching “portland”\./.test(await page.locator('#roasterStatus').textContent()));
    check(p('status is a polite live region'), (await page.locator('#roasterStatus').getAttribute('aria-live')) === 'polite');

    // State filter + URL
    await page.getByLabel('Search by name or city').fill('');
    await page.getByLabel('State').selectOption('NH');
    check(p('state filter NH'), (await visibleCards(page).count()) === count((r) => r.state === 'NH'));
    check(p('state in URL'), new URL(page.url()).searchParams.get('state') === 'NH', page.url());

    // Empty state + reset via keyboard
    await page.getByLabel('State').selectOption('');
    await page.getByLabel('Search by name or city').fill('zzzz no such roaster');
    check(p('empty state shown'), (await visibleCards(page).count()) === 0 && await page.locator('#roasterEmpty').isVisible());
    await page.locator('#roasterEmptyReset').focus();
    await page.keyboard.press('Enter');
    check(p('reset restores all'), (await visibleCards(page).count()) === DATA.length);
    check(p('reset returns focus to search'), await page.evaluate(() => document.activeElement && document.activeElement.id === 'roasterSearch'));
    check(p('reset clears URL'), new URL(page.url()).search === '', page.url());

    // Deep link
    const sample = DATA.find((r) => r.state === 'VT');
    await page.goto(`${ORIGIN}/roasters/?state=VT&q=${encodeURIComponent(sample.name.split(' ')[0])}`);
    check(p('deep link restores filters'), (await page.getByLabel('State').inputValue()) === 'VT'
        && (await visibleCards(page).count()) >= 1
        && (await visibleCards(page).count()) <= count((r) => r.state === 'VT'));

    // Keyboard: skip link first, nav reachable, current page marked
    await page.goto(`${ORIGIN}/roasters/`);
    await page.keyboard.press('Tab');
    check(p('skip link is first tab stop'), await page.evaluate(() => document.activeElement.classList.contains('skip-link')));
    await page.keyboard.press('Enter');
    check(p('skip link targets main'), page.url().endsWith('#main-content'));
    const current = page.locator('nav[aria-label="Main"] a[aria-current="page"]');
    check(p('nav marks Roasters current'), (await current.count()) === 1 && (await current.textContent()) === 'Roasters' && await current.isVisible());

    // Links: only https/same-site, match the data, never new-window
    const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target') })));
    check(p('links are https or same-site'), hrefs.every(({ href }) => href.startsWith('https://') || href.startsWith('/') || href.startsWith('#')));
    check(p('no target=_blank'), hrefs.every(({ target }) => !target));
    const shopLinks = await page.$$eval('a.roaster-shop', (as) => as.map((a) => a.href));
    check(p('shop links match data'), JSON.stringify([...shopLinks].sort()) === JSON.stringify(DATA.map((r) => r.shopUrl).sort()));

    // Layout
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(p('no horizontal overflow'), overflow <= 0, `${overflow}px`);
    const small = await page.$$eval('.roaster-actions a, .site-nav-links a, #roasterFilters input, #roasterFilters select, #roasterFilters button',
        (els) => els.filter((e) => e.getBoundingClientRect().height < 40).map((e) => e.textContent.trim() || e.id));
    check(p('touch targets >= 40px tall'), small.length === 0, small.join(', '));

    if (OUT_DIR) {
        await page.screenshot({ path: join(OUT_DIR, `roasters-${name}.png`), fullPage: true });
        await page.getByLabel('Search by name or city').fill('zzzz');
        await page.screenshot({ path: join(OUT_DIR, `roasters-${name}-empty.png`) });
    }

    check(p('no unexpected external requests'), log.unexpected.length === 0, log.unexpected.join('; '));
    check(p('no console errors'), log.consoleErrors.length === 0, log.consoleErrors.join('; '));
    await context.close();
    return log;
}

async function noJsScenario(browser, name, contextOptions) {
    const log = { unexpected: [], consoleErrors: [], analyticsBlocked: 0 };
    const context = await browser.newContext({ ...contextOptions, javaScriptEnabled: false, serviceWorkers: 'block' });
    const page = await context.newPage();
    await guard(page, log);
    const p = (label) => `[${name}, no JS] ${label}`;

    await page.goto(`${ORIGIN}/roasters/`);
    check(p('all roasters readable'), (await visibleCards(page).count()) === DATA.length);
    check(p('filter form stays hidden'), !(await page.locator('#roasterFilters').isVisible()));
    check(p('count shown'), (await page.locator('#roasterStatus').textContent()) === `Showing all ${DATA.length} roasters.`);
    check(p('methodology shown'), await page.getByRole('heading', { name: 'How this list is made' }).isVisible());
    check(p('sources disclosure per roaster'), (await page.locator('details.roaster-sources').count()) === DATA.length);
    check(p('nav present'), await page.locator('nav[aria-label="Main"]').isVisible());
    if (OUT_DIR) await page.screenshot({ path: join(OUT_DIR, `roasters-${name}-nojs.png`), fullPage: true });

    await page.goto(`${ORIGIN}/`);
    const link = page.locator('main a[href="/roasters/"]');
    check(p('homepage links to directory'), (await link.count()) === 1 && await link.isVisible());
    check(p('no unexpected external requests'), log.unexpected.length === 0, log.unexpected.join('; '));
    await context.close();
}

async function main() {
    if (OUT_DIR) await mkdir(OUT_DIR, { recursive: true });
    const server = await startServer();
    const browser = await chromium.launch();
    let analyticsBlocked = 0;
    try {
        for (const [name, opts] of Object.entries({
            desktop: { viewport: { width: 1280, height: 900 } },
            mobile: { ...devices['Pixel 7'] },
        })) {
            analyticsBlocked += (await jsScenario(browser, name, opts)).analyticsBlocked;
            await noJsScenario(browser, name, opts);
        }
    } finally {
        await browser.close();
        server.close();
    }
    for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}${c.detail && !c.ok ? `  (${c.detail})` : ''}`);
    const failed = checks.filter((c) => !c.ok).length;
    console.log(`\n${checks.length - failed}/${checks.length} checks passed; ${analyticsBlocked} analytics request(s) blocked, no outbound clicks, no forms submitted.`);
    if (failed) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
