#!/usr/bin/env node
/**
 * Prerender static state pages into public/pages/states/ from live API data:
 * {slug}.html, then {slug}-2.html, ... at SHOPS_PER_PAGE shops each, plus an
 * index at public/pages/states/index.html.
 *
 * Why: the dynamic page (/html/state.html?code=XX) renders listings and its
 * JSON-LD only after JavaScript runs, and most AI crawlers don't run JS. These
 * pages carry the same listings and structured data in plain HTML, and are the
 * canonical URLs (state.js points its canonical link here).
 *
 * Deploy builds are those with NODE_ENV=production, which the DigitalOcean
 * App Platform spec (.do/app-spec.yaml) sets at build time.
 *
 * API base: API_BASE_URL, defaulting to '/api/v1' like api-client.js. In a
 * deploy build a relative base (the same-origin setup) is resolved against
 * SITE_URL. Locally, a relative base means there is no API to build from.
 *
 * Failure policy: in a deploy build any failed fetch fails the build, so
 * App Platform keeps the last good deploy live; we never publish a partial
 * set, or canonical links to pages that don't exist. Locally, a missing or
 * unreachable API only warns and skips, leaving existing output untouched.
 *
 * Output is generated, not committed (see .gitignore).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { CSP_META_TAG, REFERRER_META_TAG } = require('./csp.cjs');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public/pages/states');
const SITE_URL = (process.env.SITE_URL || 'https://localcoffeeshop.co').replace(/\/+$/, '');

const CONCURRENCY = 5;
const TIMEOUT_MS = 10000;
const RETRIES = 3; // for 5xx, network errors and timeouts
const BACKOFF_BASE_MS = 1000; // 1s, 2s, 4s between those retries
// The API allows 100 requests per 15 minutes per IP and a build makes ~104
// (#24). On HTTP 429 every request pauses until the window resets, per
// Retry-After / RateLimit-Reset, capped so a bad header can't hang the build.
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_DEFAULT_WAIT_MS = 60 * 1000;
const RATE_LIMIT_MAX_WAIT_MS = 16 * 60 * 1000;
const PAGE_SIZE = 500; // API maximum
const MAX_PAGES = 50; // guard against a runaway hasNext
const SHOPS_PER_PAGE = 250; // keeps the largest states' pages around 100 KB

/**
 * Load the shared enums (a browser UMD script) in a sandbox, so this script
 * uses the same state names, slugs and price levels as the site.
 */
function loadEnums() {
    const src = fs.readFileSync(path.join(ROOT, 'public/enums.js'), 'utf8');
    const sandbox = { module: { exports: {} } };
    vm.runInNewContext(src, sandbox);
    return sandbox.module.exports;
}

/** Deploy (production) build, as opposed to a local one. */
function isDeployBuild(env = process.env) {
    return env.NODE_ENV === 'production';
}

/**
 * Decide where to fetch from. Returns { apiBase } (absolute URL) or
 * { skip: reason } for local builds that have no API to build from.
 */
function resolveApiTarget(env = process.env) {
    let base = env.API_BASE_URL;
    const envPath = path.join(ROOT, '.env');
    if (!base && fs.existsSync(envPath)) {
        const match = fs.readFileSync(envPath, 'utf8').match(/^API_BASE_URL=(.*)$/m);
        if (match) base = match[1].trim();
    }
    // Same default as api-client.js
    base = (base || '/api/v1').replace(/\/+$/, '');

    if (/^https?:\/\//.test(base)) return { apiBase: base };

    // Relative base: the API is served under the site's own origin.
    if (isDeployBuild(env)) {
        const site = (env.SITE_URL || SITE_URL).replace(/\/+$/, '');
        return { apiBase: new URL(base, `${site}/`).href.replace(/\/+$/, '') };
    }
    return { skip: `API_BASE_URL is "${base}", which is relative, and this isn't a deploy build (NODE_ENV=production)` };
}

/**
 * Slug for a state's static page: 'NY' -> 'new-york', 'DC' -> 'washington-d-c'.
 * public/html/state.js has the same function for its canonical link; a test
 * checks the two agree. (enums.js must stay identical to the backend repo,
 * so it can't live there.)
 */
function stateSlug(enums, code) {
    if (!enums.isStateCode(code)) return null;
    return enums.stateName(code)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Map a price-level key to a schema.org priceRange ($, $$, $$$), or null. */
function priceRangeSymbol(Price, priceLevel) {
    if (!priceLevel) return null;
    const info = Price.fromKey(priceLevel);
    const numeric = info && typeof info.numeric === 'number' ? info.numeric : 0;
    return numeric > 0 ? '$'.repeat(numeric) : null;
}

/** Stable display order, matching the dynamic page (by name). */
function sortShops(shops) {
    return shops.slice().sort((a, b) =>
        (a.displayName?.text || '').localeCompare(b.displayName?.text || ''));
}

/**
 * JSON-LD for one page of a state's listings. Same shape as state.js emits at
 * runtime, with this static page as the @id. ListItem positions continue
 * across pages (`offset` is the number of shops on earlier pages).
 */
function buildJsonLd(Price, { name, pageUrl, firstPageUrl, shops, offset = 0 }) {
    const itemListElement = shops.map((shop, i) => {
        const business = {
            '@type': 'CafeOrCoffeeShop',
            name: shop.displayName?.text || 'Coffee shop',
            address: shop.formattedAddress || undefined,
            areaServed: name,
        };
        const priceRange = priceRangeSymbol(Price, shop.priceLevel);
        if (priceRange) business.priceRange = priceRange;
        return { '@type': 'ListItem', position: offset + i + 1, item: business };
    });

    const graph = [
        {
            '@type': 'BreadcrumbList',
            itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
                { '@type': 'ListItem', position: 2, name: 'States', item: `${SITE_URL}/pages/states/` },
                { '@type': 'ListItem', position: 3, name: `Coffee Shops in ${name}`, item: firstPageUrl || pageUrl },
            ],
        },
        {
            '@type': 'CollectionPage',
            '@id': pageUrl,
            url: pageUrl,
            name: `Coffee Shops in ${name}`,
            description: `Discover local coffee shops in ${name}. Browse cafes, compare price levels, and find your next favorite coffee spot.`,
            isPartOf: { '@type': 'WebSite', name: 'Local Coffee Shops', url: `${SITE_URL}/` },
            about: {
                '@type': 'AdministrativeArea',
                name,
                containedInPlace: { '@type': 'Country', name: 'United States' },
            },
            mainEntity: {
                '@type': 'ItemList',
                name: `Coffee shops in ${name}`,
                numberOfItems: itemListElement.length,
                itemListElement,
            },
        },
    ];

    // Escape "<" so a stray "</script>" in any field can't end the tag.
    return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })
        .replace(/</g, '\\u003c');
}

/** Shared <head> boilerplate for generated pages (CSP: see scripts/csp.cjs). */
function renderHead({ title, description, canonical, noindex, prev, next }) {
    const t = escapeHtml(title);
    const d = escapeHtml(description);
    const c = escapeHtml(canonical);
    const rel = (prev ? `\n    <link rel="prev" href="${escapeHtml(prev)}">` : '')
        + (next ? `\n    <link rel="next" href="${escapeHtml(next)}">` : '');
    return `    <meta charset="UTF-8">
    ${CSP_META_TAG}
    ${REFERRER_META_TAG}
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${t}</title>
    <meta name="description" content="${d}">
    <meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow'}">
    <link rel="canonical" href="${c}">${rel}

    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website">
    <meta property="og:url" content="${c}">
    <meta property="og:title" content="${t}">
    <meta property="og:description" content="${d}">
    <meta property="og:site_name" content="Local Coffee Shops">

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${t}">
    <meta name="twitter:description" content="${d}">

    <!-- Theme + PWA -->
    <meta name="theme-color" content="#2C3E50">
    <link rel="manifest" href="/manifest.json">
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">

    <link rel="stylesheet" href="/dist/styles.min.css">`;
}

/** File name for page `n` (1-based) of a state: texas.html, texas-2.html, ... */
function pageFileName(slug, n) {
    return n === 1 ? `${slug}.html` : `${slug}-${n}.html`;
}

/** Numbered pagination links; the current page is marked with aria-current. */
function renderPagination(slug, page, pageCount) {
    if (pageCount <= 1) return '';
    const link = (n, label, rel) =>
        `<a href="/pages/states/${pageFileName(slug, n)}"${rel ? ` rel="${rel}"` : ''}>${label}</a>`;
    const parts = [];
    if (page > 1) parts.push(link(page - 1, '← Prev', 'prev'));
    for (let n = 1; n <= pageCount; n++) {
        parts.push(n === page ? `<span aria-current="page">${n}</span>` : link(n, String(n)));
    }
    if (page < pageCount) parts.push(link(page + 1, 'Next →', 'next'));
    return `
        <nav class="pagination" aria-label="Pages">
            ${parts.join('\n            ')}
        </nav>`;
}

/**
 * Render every page for one state, SHOPS_PER_PAGE shops each.
 * Returns [{ fileName, html }]; a state with no shops gets one noindex page.
 */
function renderStatePages(enums, { code, shops }) {
    const { Price, stateName } = enums;
    const name = stateName(code);
    const slug = stateSlug(enums, code);
    const urlFor = (n) => `${SITE_URL}/pages/states/${pageFileName(slug, n)}`;
    const sorted = sortShops(shops);
    const total = sorted.length;
    const avg = Price.average(sorted.map((s) => Price.fromKey(s.priceLevel))).label;
    const pageCount = Math.max(1, Math.ceil(total / SHOPS_PER_PAGE));

    const pages = [];
    for (let page = 1; page <= pageCount; page++) {
        const offset = (page - 1) * SHOPS_PER_PAGE;
        const pageShops = sorted.slice(offset, offset + SHOPS_PER_PAGE);
        const pageUrl = urlFor(page);
        const suffix = pageCount > 1 ? ` (page ${page} of ${pageCount})` : '';

        const items = pageShops.map((shop) => {
            const priceInfo = shop.priceLevel ? Price.fromKey(shop.priceLevel) : null;
            const price = priceInfo && priceInfo.numeric > 0
                ? `\n                <span class="price-level ${escapeHtml(priceInfo.cssClass)}" aria-label="Price level: ${escapeHtml(priceInfo.label.toLowerCase())}">${escapeHtml(priceInfo.label.toLowerCase())}</span>`
                : '';
            return `            <li class="coffee-item">
                <h3>${escapeHtml(shop.displayName?.text || 'Unknown')}</h3>
                <p>${escapeHtml(shop.formattedAddress || '')}</p>${price}
            </li>`;
        }).join('\n');

        const list = total
            ? items
            : '            <li class="coffee-item"><p>No coffee shops listed in this state yet.</p></li>';
        const showing = pageCount > 1
            ? `\n            <p>Showing ${offset + 1}–${offset + pageShops.length} of ${total}</p>`
            : '';
        const pagination = renderPagination(slug, page, pageCount);

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
${renderHead({
        title: `Coffee Shops in ${name}${suffix} | Local Coffee Shops`,
        description: `Discover ${total || 'local'} coffee shops in ${name}${suffix}. Browse local cafes, compare price levels, and find your next favorite coffee spot.`,
        canonical: pageUrl,
        noindex: total === 0,
        prev: page > 1 ? urlFor(page - 1) : null,
        next: page < pageCount ? urlFor(page + 1) : null,
    })}
    <script type="application/ld+json">${buildJsonLd(Price, { name, pageUrl, firstPageUrl: urlFor(1), shops: pageShops, offset })}</script>
</head>
<body>
    <div class="container">
        <a href="/pages/states/" class="back-button">← All states</a>
        <h1>Coffee Shops in ${escapeHtml(name)}</h1>
        <div class="state-info">
            <p>Total Coffee Shops: <span>${total}</span></p>
            <p>Average Price Level: <span>${escapeHtml(avg)}</span></p>${showing}
            <p><a href="/html/state.html?code=${escapeHtml(code)}">Open the interactive view</a></p>
        </div>${pagination}
        <ul class="coffee-list">
${list}
        </ul>${pagination}
    </div>
</body>
</html>
`;
        pages.push({ fileName: pageFileName(slug, page), html });
    }
    return pages;
}

/** Index of all states with real shop counts. */
function renderIndexPage(enums, results) {
    const { stateName } = enums;
    const rows = results
        .slice()
        .sort((a, b) => stateName(a.code).localeCompare(stateName(b.code)))
        .map(({ code, shops }) => `            <li class="coffee-item">
                <h3><a href="/pages/states/${stateSlug(enums, code)}.html">${escapeHtml(stateName(code))}</a></h3>
                <p>${shops.length} coffee shop${shops.length === 1 ? '' : 's'}</p>
            </li>`)
        .join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
${renderHead({
        title: 'Coffee Shops by State | Local Coffee Shops',
        description: 'Browse local coffee shops in every US state. Find independent cafes near you or wherever you are traveling.',
        canonical: `${SITE_URL}/pages/states/`,
        noindex: false,
    })}
</head>
<body>
    <div class="container">
        <a href="/" class="back-button">← Home</a>
        <h1>Coffee Shops by State</h1>
        <ul class="coffee-list">
${rows}
        </ul>
    </div>
</body>
</html>
`;
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How long a 429 asks us to wait, in ms: Retry-After (seconds or HTTP date),
 * else RateLimit-Reset (seconds), else a default. Capped.
 */
function rateLimitWaitMs(res, now = Date.now()) {
    const retryAfter = res.headers.get('retry-after');
    let ms = NaN;
    if (retryAfter) {
        ms = /^\d+$/.test(retryAfter.trim())
            ? Number(retryAfter) * 1000
            : Date.parse(retryAfter) - now;
    }
    if (!(ms >= 0)) {
        const resetHeader = res.headers.get('ratelimit-reset');
        const reset = resetHeader === null ? NaN : Number(resetHeader);
        ms = Number.isFinite(reset) && reset >= 0 ? reset * 1000 : RATE_LIMIT_DEFAULT_WAIT_MS;
    }
    return Math.min(Math.max(ms, 0), RATE_LIMIT_MAX_WAIT_MS);
}

/** Shared by every request in a run, so one 429 pauses them all. */
function createRateLimitGate() {
    return { resumeAt: 0 };
}

/**
 * Fetch one URL and unwrap the API envelope.
 * - 429: wait until the rate-limit window resets (shared gate), then retry.
 * - 5xx, network errors, timeouts: exponential backoff, then retry.
 * - other 4xx and malformed bodies: fail immediately; retrying won't help.
 */
async function fetchEnvelope(url, {
    fetchImpl, retries, timeoutMs,
    sleep = realSleep, now = Date.now, gate = createRateLimitGate(), log = console,
}) {
    let transientRetries = 0;
    let rateLimitRetries = 0;
    for (;;) {
        const pause = gate.resumeAt - now();
        if (pause > 0) await sleep(pause);

        let res;
        try {
            res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
        } catch (err) {
            // Network error or timeout
            if (transientRetries >= retries) throw err;
            await sleep(BACKOFF_BASE_MS * 2 ** transientRetries++);
            continue;
        }

        if (res.status === 429) {
            if (rateLimitRetries++ >= RATE_LIMIT_RETRIES) {
                throw new Error(`HTTP 429 for ${url} (still rate-limited after ${RATE_LIMIT_RETRIES} waits)`);
            }
            const waitMs = rateLimitWaitMs(res, now());
            const resumeAt = now() + waitMs;
            if (resumeAt > gate.resumeAt) {
                gate.resumeAt = resumeAt;
                log.warn(`⏳ API rate limit hit (HTTP 429); pausing all requests for ${Math.ceil(waitMs / 1000)}s`);
            }
            continue;
        }

        if (res.status >= 500) {
            if (transientRetries >= retries) throw new Error(`HTTP ${res.status} for ${url}`);
            await sleep(BACKOFF_BASE_MS * 2 ** transientRetries++);
            continue;
        }

        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const body = await res.json();
        if (!body || body.success !== true || !Array.isArray(body.data)) {
            throw new Error(`Unexpected response shape from ${url}`);
        }
        return body;
    }
}

/**
 * Fetch every shop for a state. The API pages results (default 100, max 500
 * per page) and reports metadata.pagination.hasNext; follow it to the end.
 */
async function fetchStateShops(apiBase, code, {
    fetchImpl = fetch, retries = RETRIES, timeoutMs = TIMEOUT_MS,
    sleep, now, gate, log,
} = {}) {
    const shops = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        const url = `${apiBase}/states/${code}?page=${page}&limit=${PAGE_SIZE}`;
        const body = await fetchEnvelope(url, { fetchImpl, retries, timeoutMs, sleep, now, gate, log });
        shops.push(...body.data);
        if (!body.metadata?.pagination?.hasNext) return shops;
    }
    throw new Error(`More than ${MAX_PAGES} pages of shops for ${code}; refusing to continue`);
}

/** Run `task` over `items` with at most `limit` in flight. */
async function mapWithConcurrency(items, limit, task) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await task(items[i]);
        }
    });
    await Promise.all(workers);
    return results;
}

async function main({
    env = process.env, fetchImpl = fetch, outDir = OUT_DIR, log = console,
    sleep = realSleep, now = Date.now,
} = {}) {
    const { apiBase, skip } = resolveApiTarget(env);
    if (skip) {
        log.warn(`⚠️  Skipping state prerender: ${skip}. State pages will be missing from this build.`);
        return { skipped: true };
    }

    const enums = loadEnums();
    const codes = enums.allStateCodes();
    const gate = createRateLimitGate(); // one 429 pauses every worker in this run
    let results;
    try {
        results = await mapWithConcurrency(codes, CONCURRENCY, async (code) => ({
            code,
            shops: await fetchStateShops(apiBase, code, { fetchImpl, sleep, now, gate, log }),
        }));
    } catch (err) {
        if (isDeployBuild(env)) throw err;
        // Local build with the API not running: don't break `npm run build`
        log.warn(`⚠️  Skipping state prerender: couldn't fetch from ${apiBase} (${err.message}). Existing state pages left as-is.`);
        return { skipped: true };
    }

    // Only touch the output directory once every fetch has succeeded.
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    let fileCount = 0;
    for (const result of results) {
        for (const { fileName, html } of renderStatePages(enums, result)) {
            fs.writeFileSync(path.join(outDir, fileName), html);
            fileCount++;
        }
    }
    fs.writeFileSync(path.join(outDir, 'index.html'), renderIndexPage(enums, results));

    const total = results.reduce((n, r) => n + r.shops.length, 0);
    const empty = results.filter((r) => r.shops.length === 0).length;
    log.log(`✅ Prerendered ${results.length} states as ${fileCount} pages (${total} shops, ${empty} empty/noindex) -> ${path.relative(process.cwd(), outDir)}`);
    return { skipped: false, results };
}

module.exports = {
    loadEnums,
    isDeployBuild,
    resolveApiTarget,
    stateSlug,
    escapeHtml,
    priceRangeSymbol,
    buildJsonLd,
    pageFileName,
    renderStatePages,
    renderIndexPage,
    renderHead,
    fetchStateShops,
    rateLimitWaitMs,
    mapWithConcurrency,
    main,
};

if (require.main === module) {
    main().catch((err) => {
        console.error('❌ State prerender failed in a deploy build; failing the build so the last good deploy stays live.');
        console.error(err);
        process.exit(1);
    });
}
