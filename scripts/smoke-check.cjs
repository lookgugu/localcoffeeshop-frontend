#!/usr/bin/env node
/**
 * Smoke check for the public site and the API's basic contract.
 *
 *   node scripts/smoke-check.cjs
 *
 * GET requests only, about 7 in total (3 to the API, which allows 100 per
 * 15 minutes per IP, #24). Pages are fetched as text and never executed,
 * so no analytics fire. Quiet on success (exit 0). On failure prints one
 * line per problem, naming the URL and what was expected, and exits 1.
 *
 * Targets: SMOKE_SITE_URL (default https://localcoffeeshop.co) and
 * SMOKE_API_URL (default https://api.localcoffeeshop.co/api/v1).
 */

const DEFAULT_SITE_URL = 'https://localcoffeeshop.co';
const DEFAULT_API_URL = 'https://api.localcoffeeshop.co/api/v1';
const TIMEOUT_MS = 15000;

const trimSlash = (url) => url.replace(/\/+$/, '');

/**
 * GET `url`. Returns { res, text } or pushes a problem and returns null.
 * A 429 is reported as rate limiting, not as the endpoint being down.
 */
async function get(url, { fetchImpl, timeoutMs, problems }) {
    let res;
    try {
        res = await fetchImpl(url, {
            method: 'GET',
            headers: { 'user-agent': 'localcoffeeshop-smoke-check' },
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (err) {
        problems.push(`${url}: request failed (${err.message}). Check DNS/TLS and that the host is up.`);
        return null;
    }
    if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        problems.push(`${url}: rate limited (HTTP 429)${retryAfter ? `, retry after ${retryAfter}s` : ''}. Not an outage; rerun later or from another IP (#24).`);
        return null;
    }
    if (!res.ok) {
        problems.push(`${url}: expected HTTP 200, got HTTP ${res.status}.`);
        return null;
    }
    return { res, text: await res.text() };
}

/** GET a page and check it contains each `[needle, description]`. */
async function checkPage(url, needles, ctx) {
    const page = await get(url, ctx);
    if (!page) return;
    for (const [needle, description] of needles) {
        if (!page.text.includes(needle)) {
            ctx.problems.push(`${url}: missing ${description} (looked for ${JSON.stringify(needle)}). Was the last deploy built correctly?`);
        }
    }
}

/** GET an API endpoint and unwrap its { success: true, data } envelope, or null. */
async function getEnvelope(url, ctx) {
    const page = await get(url, ctx);
    if (!page) return null;
    let body;
    try {
        body = JSON.parse(page.text);
    } catch (err) {
        ctx.problems.push(`${url}: response is not JSON (${err.message}).`);
        return null;
    }
    if (!body || typeof body !== 'object' || body.success !== true || !('data' in body)) {
        ctx.problems.push(`${url}: expected the API envelope { success: true, data }, got ${JSON.stringify(body).slice(0, 120)}.`);
        return null;
    }
    return body;
}

async function runSmokeCheck({
    siteUrl = DEFAULT_SITE_URL, apiUrl = DEFAULT_API_URL, fetchImpl = fetch, timeoutMs = TIMEOUT_MS,
} = {}) {
    const site = trimSlash(siteUrl);
    const api = trimSlash(apiUrl);
    const problems = [];
    const ctx = { fetchImpl, timeoutMs, problems };

    // Site: the pages a visitor lands on, and the homepage bundle.
    await checkPage(`${site}/`, [
        ['http-equiv="Content-Security-Policy"', 'the CSP meta tag'],
        ['/dist/app.bundle.min.js', 'the app bundle script'],
        ['id="stateGrid"', 'the state grid (id="stateGrid")'],
    ], ctx);
    await checkPage(`${site}/pages/states/`, [
        ['href="/pages/states/', 'links to the prerendered state pages'],
    ], ctx);
    await checkPage(`${site}/html/state.html`, [
        ['/dist/state.bundle.min.js', 'the state page bundle script'],
    ], ctx);
    const bundle = await get(`${site}/dist/app.bundle.min.js`, ctx);
    if (bundle && !bundle.text.trim()) problems.push(`${site}/dist/app.bundle.min.js: empty file.`);

    // API: the fields the frontend reads.
    await getEnvelope(`${api}/health`, ctx);

    const states = await getEnvelope(`${api}/states`, ctx);
    let sampleCode = null;
    if (states) {
        const data = states.data;
        const valid = Array.isArray(data) && data.length > 0
            && data.every((s) => s && typeof s.state_code === 'string' && typeof s.shop_count === 'number');
        if (!valid) {
            problems.push(`${api}/states: expected a non-empty array of { state_code: string, shop_count: number }.`);
        } else {
            const withShops = data.find((s) => s.shop_count > 0);
            sampleCode = withShops ? withShops.state_code : null;
        }
    }

    if (sampleCode) {
        const url = `${api}/states/${encodeURIComponent(sampleCode)}?page=1&limit=1`;
        const shops = await getEnvelope(url, ctx);
        if (shops) {
            const total = shops.metadata && shops.metadata.pagination && shops.metadata.pagination.total;
            if (!Array.isArray(shops.data) || typeof total !== 'number') {
                problems.push(`${url}: expected data: [] with metadata.pagination.total (a number).`);
            } else if (shops.data.length && typeof shops.data[0]?.displayName?.text !== 'string') {
                problems.push(`${url}: expected shops with displayName.text (a string).`);
            }
        }
    }

    return problems;
}

async function main({ env = process.env, fetchImpl = fetch, log = console } = {}) {
    const problems = await runSmokeCheck({
        siteUrl: env.SMOKE_SITE_URL || DEFAULT_SITE_URL,
        apiUrl: env.SMOKE_API_URL || DEFAULT_API_URL,
        fetchImpl,
    });
    if (!problems.length) return 0;
    log.error(`Smoke check failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
    for (const problem of problems) log.error(`  - ${problem}`);
    return 1;
}

module.exports = { runSmokeCheck, main, DEFAULT_SITE_URL, DEFAULT_API_URL };

if (require.main === module) {
    main().then((code) => { process.exitCode = code; });
}
