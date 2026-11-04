#!/usr/bin/env node
/**
 * Make the built homepage (public/index.html, copied from public/html/ by
 * build:html) paint its real content in one round trip on mobile.
 *
 * Without this, a cold mobile visit waits on: the HTML, then the stylesheet
 * and four render-blocking head scripts, then the deferred bundle, then a
 * cross-origin /states request, before the state grid (the page's main
 * content) appears. This step removes everything after the HTML from that
 * path:
 *
 * 1. Prerenders the state grid and the state filter's options from the API's
 *    /states, using the same markup as createStateGrid() in frontend.js. The
 *    bundle still fetches /states on load and re-renders it with live data.
 * 2. Inlines the stylesheet and config.js, so the only render-blocking
 *    requests left are the three small analytics head scripts, which must
 *    stay external (see INLINE_SCRIPTS). The CSP already allows inline
 *    scripts and styles. The files stay published for the other pages.
 *
 * Only the build output is rewritten; public/html/index.html, which the tests
 * check for script order, is the untouched source.
 *
 * Failure policy: the grid is an enhancement, the bundle renders it anyway, so
 * a failed /states fetch only warns and leaves the loading indicator, even in
 * a deploy build (build:states already fails a deploy build when the API is
 * down). Missing files are a build bug and always fail.
 */
const fs = require('fs');
const path = require('path');
const { loadEnums, escapeHtml, resolveApiTarget, fetchEnvelope } = require('./prerender-states.cjs');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
// Only config.js: the analytics head scripts stay external, parser-blocking
// files on every page (tests/unit/analytics-pages.test.js: no inline gtag).
const INLINE_SCRIPTS = ['/config.js'];
const STYLESHEET = '/dist/styles.min.css';
const TIMEOUT_MS = 10000;
const RETRIES = 2;

/** Same filter as isValidStateInfo() in frontend.js, sorted by code like initializeStateList(). */
function validStates(data) {
    return data
        .filter((s) => s && typeof s === 'object' && typeof s.state_code === 'string' && typeof s.shop_count === 'number')
        .sort((a, b) => a.state_code.localeCompare(b.state_code));
}

/** The markup createStateGrid() in frontend.js builds for each card. */
function renderStateGrid(enums, states) {
    return states.map((s) => {
        const code = escapeHtml(s.state_code);
        const name = escapeHtml(enums.stateName(s.state_code));
        const price = escapeHtml(enums.Price.averageFromNumeric(s.avg_price_level).label);
        return `<div class="state-card" id="state-card-${code}" role="gridcell">`
            + `<a href="/html/state.html?code=${code}" aria-label="${name}: ${s.shop_count} coffee shops">`
            + `<h2>${name}</h2><p>${s.shop_count} coffee shops</p><p>Avg. price: ${price}</p></a></div>`;
    }).join('');
}

function renderStateOptions(enums, states) {
    return states
        .map((s) => `<option value="${escapeHtml(s.state_code)}">${escapeHtml(enums.stateName(s.state_code))}</option>`)
        .join('');
}

/**
 * Replace exactly one match of `pattern` in `html`, or throw. `replacement`
 * is a string (inserted literally) or a function of the match's groups.
 */
function replaceOnce(html, pattern, replacement, what) {
    const count = (html.match(new RegExp(pattern.source, `${pattern.flags}g`)) || []).length;
    if (count !== 1) {
        throw new Error(`optimize-home: expected exactly one ${what} in index.html, found ${count}`);
    }
    return html.replace(pattern, typeof replacement === 'function' ? replacement : () => replacement);
}

/** Put the state cards and filter options into the page. */
function prerenderStates(html, enums, states) {
    html = replaceOnce(
        html,
        /(<section[^>]*id="stateGrid"[^>]*>)[\s\S]*?(<\/section>)/,
        (_match, open, close) => `${open}${renderStateGrid(enums, states)}${close}`,
        'state grid'
    );
    return replaceOnce(
        html,
        /<option value="">All States<\/option>/,
        `<option value="">All States</option>${renderStateOptions(enums, states)}`,
        '"All States" option'
    );
}

function readPublic(url) {
    return fs.readFileSync(path.join(PUBLIC, url), 'utf8');
}

/** Inline the stylesheet and render-blocking head scripts. */
function inlineCriticalAssets(html, read = readPublic) {
    const css = read(STYLESHEET).trim();
    html = replaceOnce(
        html,
        new RegExp(`<link rel="stylesheet" href="${STYLESHEET.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}">`),
        `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`,
        `${STYLESHEET} link`
    );
    for (const src of INLINE_SCRIPTS) {
        const code = read(src).trim();
        if (/<\/script/i.test(code)) throw new Error(`optimize-home: ${src} contains "</script" and can't be inlined`);
        html = replaceOnce(
            html,
            new RegExp(`<script src="${src.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"></script>`),
            `<script>${code}</script>`,
            `${src} script tag`
        );
    }
    return html;
}

async function fetchStates(env, { fetchImpl = fetch, log = console } = {}) {
    const { apiBase, skip } = resolveApiTarget(env);
    if (skip) {
        log.warn(`⚠️  Not prerendering the homepage state grid: ${skip}.`);
        return null;
    }
    try {
        const body = await fetchEnvelope(`${apiBase}/states`, { fetchImpl, retries: RETRIES, timeoutMs: TIMEOUT_MS, log });
        return validStates(body.data);
    } catch (err) {
        log.warn(`⚠️  Not prerendering the homepage state grid: couldn't fetch ${apiBase}/states (${err.message}). The page will load it at runtime.`);
        return null;
    }
}

async function main({ env = process.env, fetchImpl = fetch, file = path.join(PUBLIC, 'index.html'), read = readPublic, log = console } = {}) {
    let html = fs.readFileSync(file, 'utf8');
    const states = await fetchStates(env, { fetchImpl, log });
    if (states && states.length) html = prerenderStates(html, loadEnums(), states);
    html = inlineCriticalAssets(html, read);
    fs.writeFileSync(file, html);
    log.log(`✅ Optimized ${path.relative(process.cwd(), file)} (${states ? states.length : 0} states prerendered, CSS + ${INLINE_SCRIPTS.join(', ')} inlined, ${Buffer.byteLength(html)} bytes)`);
    return { html, states };
}

module.exports = { renderStateGrid, renderStateOptions, prerenderStates, inlineCriticalAssets, validStates, main, INLINE_SCRIPTS };

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
