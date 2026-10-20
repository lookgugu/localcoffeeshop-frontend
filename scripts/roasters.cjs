#!/usr/bin/env node
/**
 * Curated roaster directory (#50): validate data/roasters.json and prerender
 * public/roasters/index.html from it.
 *
 *   node scripts/roasters.cjs           # validate, then write the page (build:roasters)
 *   node scripts/roasters.cjs --check   # validate only (check:roasters, CI)
 *
 * The data is hand-curated and version-controlled: each row was checked
 * against the roaster's own website, with the pages that show it (sources)
 * and the date it was checked. Shipping and pickup are "offered" only when
 * the roaster's site says so, with that page as evidence; otherwise they stay
 * "unknown" and the page says "Not confirmed". The validator rejects anything
 * that doesn't meet that bar, duplicate rows, unsafe URLs and unexpected
 * fields (so prices, ratings or prose can't creep in unreviewed), and the
 * build fails rather than publishing an unchecked row.
 *
 * Every listing is in the HTML, so the page works without JavaScript;
 * public/roasters.js only adds search and the state filter on top.
 * Output is generated, not committed (see .gitignore).
 */
const fs = require('fs');
const path = require('path');
const { escapeHtml, loadEnums, renderHead } = require('./prerender-states.cjs');
const { renderWaitlistSection } = require('./waitlist-markup.cjs');

const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data/roasters.json');
const OUT_FILE = path.join(ROOT, 'public/roasters/index.html');
const SITE_URL = (process.env.SITE_URL || 'https://localcoffeeshop.co').replace(/\/+$/, '');
const PAGE_PATH = '/roasters/';

const enums = loadEnums();

/** "2026-10-18" -> "October 18, 2026" (UTC, so the build's timezone can't shift it). */
function formatDate(iso) {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
    });
}

/** Display order: by name, then city (stable across builds). */
function sortRows(rows) {
    return rows.slice().sort((a, b) =>
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.city.localeCompare(b.city));
}

/** Lowercased, accent-free text used for search; same as roasters.js normalize(). */
function searchText(value) {
    return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Short, readable label for a source link: host + path, no protocol or "www.". */
function sourceLabel(url) {
    const u = new URL(url);
    const p = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '');
    return u.hostname.replace(/^www\./, '') + p;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ROW_FIELDS = ['id', 'name', 'city', 'state', 'website', 'shopUrl', 'officialStore', 'checkedAt', 'sources', 'shipping', 'pickup'];
const STORE_FIELDS = ['host', 'linkedFrom', 'evidence'];
const SOURCE_FIELDS = ['url', 'evidence'];
const FULFILLMENT_FIELDS = { offered: ['status', 'sourceUrl', 'evidence'], unknown: ['status'] };
const MAX_EVIDENCE = 160; // a short quote or note, not copied prose
const MAX_TEXT = 80;

/**
 * Parse a URL we're willing to publish as a link: absolute https, a public
 * hostname (no localhost, IP literals or credentials). Returns URL or null.
 */
function safeHttpsUrl(value) {
    if (typeof value !== 'string' || !/^https:\/\//i.test(value)) return null;
    let u;
    try {
        u = new URL(value);
    } catch {
        return null;
    }
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    if (!host.includes('.') || host.endsWith('.localhost') || host.startsWith('[')
        || /^\d+(\.\d+){3}$/.test(host)) return null;
    return u;
}

/** Registrable-ish domain ("shop.example.com" -> "example.com"); fine for the US sites listed. */
function baseDomain(host) {
    return host.toLowerCase().replace(/^www\./, '').split('.').slice(-2).join('.');
}

/**
 * Official: on the website's domain (or a subdomain), or on the exact hosted
 * store host (e.g. name.myshopify.com) the website is shown to link to.
 */
function isOfficial(url, official) {
    const u = safeHttpsUrl(url);
    if (!u || !official || !official.domain) return false;
    return baseDomain(u.hostname) === official.domain
        || (Boolean(official.storeHost) && u.hostname.toLowerCase() === official.storeHost);
}

/** officialStore: { host, linkedFrom (page on the website), evidence }. Returns the host or null. */
function checkOfficialStore(errors, where, store, domain) {
    if (store === undefined) return null;
    if (!store || typeof store !== 'object' || Array.isArray(store)) {
        errors.push(`${where}: officialStore must be an object`);
        return null;
    }
    checkFields(errors, `${where} officialStore`, store, STORE_FIELDS);
    const hostUrl = typeof store.host === 'string' && /^[a-z0-9.-]+$/.test(store.host) ? safeHttpsUrl(`https://${store.host}/`) : null;
    if (!hostUrl) errors.push(`${where}: officialStore.host must be a lowercase hostname`);
    if (!isOfficial(store.linkedFrom, { domain })) {
        errors.push(`${where}: officialStore.linkedFrom must be the official-website page that links to the store`);
    }
    checkText(errors, where, 'officialStore.evidence', store.evidence, MAX_EVIDENCE);
    return hostUrl ? hostUrl.hostname : null;
}

const normalizeName = (name) => searchText(name).replace(/[^a-z0-9]+/g, ' ').trim();
const normalizeUrl = (u) => `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();

function isIsoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function checkText(errors, where, field, value, max = MAX_TEXT) {
    if (typeof value !== 'string' || !value.trim()) errors.push(`${where}: ${field} is required`);
    else if (value !== value.trim() || value.length > max) errors.push(`${where}: ${field} must be trimmed and at most ${max} characters`);
}

function checkFields(errors, where, obj, allowed) {
    for (const key of Object.keys(obj)) {
        if (!allowed.includes(key)) errors.push(`${where}: unexpected field "${key}"`);
    }
}

function checkFulfillment(errors, where, kind, info, official) {
    if (!info || typeof info !== 'object') {
        errors.push(`${where}: ${kind} is required ({ "status": "unknown" } if the official site doesn't say)`);
        return;
    }
    const allowed = FULFILLMENT_FIELDS[info.status];
    if (!allowed) {
        errors.push(`${where}: ${kind}.status must be "offered" or "unknown"`);
        return;
    }
    checkFields(errors, `${where} ${kind}`, info, allowed);
    if (info.status === 'offered') {
        if (!isOfficial(info.sourceUrl, official)) {
            errors.push(`${where}: ${kind}.sourceUrl must be a page on the official site`);
        }
        checkText(errors, where, `${kind}.evidence`, info.evidence, MAX_EVIDENCE);
    }
}

/**
 * Validate a dataset. Returns { errors: string[], warnings: string[], rows }.
 * `today` (YYYY-MM-DD) is injectable for tests; checkedAt can't be later.
 */
function validateRoasters(data, { today = new Date().toISOString().slice(0, 10), staleAfterDays = 365 } = {}) {
    const errors = [];
    const warnings = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { errors: ['data must be an object with "version" and "roasters"'], warnings, rows: [] };
    }
    if (data.version !== 1) errors.push('version must be 1');
    checkFields(errors, 'data', data, ['version', 'roasters']);
    const rows = Array.isArray(data.roasters) ? data.roasters : [];
    if (!rows.length) errors.push('roasters must be a non-empty array');

    const seen = { id: new Map(), name: new Map(), website: new Map(), shopUrl: new Map() };
    const dup = (kind, key, where) => {
        if (key === null) return;
        if (seen[kind].has(key)) errors.push(`${where}: duplicate ${kind} (same as ${seen[kind].get(key)})`);
        else seen[kind].set(key, where);
    };

    rows.forEach((row, i) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
            errors.push(`roasters[${i}]: must be an object`);
            return;
        }
        const where = `roasters[${i}] (${row.id || 'no id'})`;
        checkFields(errors, where, row, ROW_FIELDS);

        if (typeof row.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.id)) {
            errors.push(`${where}: id must be lowercase kebab-case`);
        }
        checkText(errors, where, 'name', row.name);
        checkText(errors, where, 'city', row.city);
        if (!enums.isStateCode(row.state)) errors.push(`${where}: state must be a US state code`);

        if (!isIsoDate(row.checkedAt)) errors.push(`${where}: checkedAt must be a YYYY-MM-DD date`);
        else if (row.checkedAt > today) errors.push(`${where}: checkedAt ${row.checkedAt} is in the future`);
        else if ((Date.parse(today) - Date.parse(row.checkedAt)) / 864e5 > staleAfterDays) {
            warnings.push(`${where}: last checked ${row.checkedAt}, over ${staleAfterDays} days ago; re-check it`);
        }

        const website = safeHttpsUrl(row.website);
        if (!website) errors.push(`${where}: website must be a public https URL`);
        const domain = website ? baseDomain(website.hostname) : null;
        const official = { domain, storeHost: checkOfficialStore(errors, where, row.officialStore, domain) };
        const shop = safeHttpsUrl(row.shopUrl);
        if (!shop) errors.push(`${where}: shopUrl must be a public https URL`);
        else if (domain && !isOfficial(row.shopUrl, official)) {
            errors.push(`${where}: shopUrl must be on the official site (${domain}${official.storeHost ? ` or ${official.storeHost}` : ''})`);
        }

        if (!Array.isArray(row.sources) || !row.sources.length) {
            errors.push(`${where}: at least one source is required`);
        } else {
            row.sources.forEach((s, j) => {
                const sw = `${where} sources[${j}]`;
                if (!s || typeof s !== 'object') {
                    errors.push(`${sw}: must be an object`);
                    return;
                }
                checkFields(errors, sw, s, SOURCE_FIELDS);
                if (!isOfficial(s.url, official)) errors.push(`${sw}: url must be a page on the official site`);
                checkText(errors, sw, 'evidence', s.evidence, MAX_EVIDENCE);
            });
            if (domain && !row.sources.some((s) => s && isOfficial(s.url, { domain }))) {
                errors.push(`${where}: needs at least one source on the official website (${domain}) itself`);
            }
        }

        checkFulfillment(errors, where, 'shipping', row.shipping, official);
        checkFulfillment(errors, where, 'pickup', row.pickup, official);

        dup('id', typeof row.id === 'string' ? row.id : null, where);
        dup('name', typeof row.name === 'string' ? normalizeName(row.name) : null, where);
        dup('website', website ? website.hostname.replace(/^www\./, '') : null, where);
        dup('shopUrl', shop ? normalizeUrl(shop) : null, where);
    });

    return { errors, warnings, rows };
}

/** Counts for the build log and reports. */
function summarize(rows) {
    const byState = {};
    for (const r of rows) byState[r.state] = (byState[r.state] || 0) + 1;
    const count = (kind) => rows.filter((r) => r[kind] && r[kind].status === 'offered').length;
    return {
        total: rows.length,
        uniqueIds: new Set(rows.map((r) => r.id)).size,
        byState,
        shippingOffered: count('shipping'),
        pickupOffered: count('pickup'),
        sources: rows.reduce((n, r) => n + r.sources.length, 0),
    };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const FULFILLMENT_LABELS = { shipping: 'Shipping', pickup: 'Pickup' };

function renderFulfillment(kind, info) {
    const label = FULFILLMENT_LABELS[kind];
    if (info.status === 'offered') {
        return `<div class="roaster-fact">
                        <dt>${label}</dt>
                        <dd class="fulfillment-offered">Offered, per <a href="${escapeHtml(info.sourceUrl)}" rel="noopener">the roaster's site</a></dd>
                    </div>`;
    }
    return `<div class="roaster-fact">
                        <dt>${label}</dt>
                        <dd class="fulfillment-unknown">Not confirmed</dd>
                    </div>`;
}

function renderRow(row) {
    const name = escapeHtml(row.name);
    const stateName = enums.stateName(row.state);
    const sources = row.sources.map((s) => `
                        <li><a href="${escapeHtml(s.url)}" rel="noopener">${escapeHtml(sourceLabel(s.url))}</a>: ${escapeHtml(s.evidence)}</li>`).join('');
    return `            <li class="roaster-card" id="roaster-${escapeHtml(row.id)}" data-name="${escapeHtml(searchText(row.name))}" data-city="${escapeHtml(searchText(row.city))}" data-state="${escapeHtml(row.state)}">
                <h3 class="roaster-name">${name}</h3>
                <p class="roaster-location">${escapeHtml(row.city)}, ${escapeHtml(row.state)}<span class="visually-hidden"> (${escapeHtml(stateName)})</span></p>
                <dl class="roaster-facts">
                    ${renderFulfillment('shipping', row.shipping)}
                    ${renderFulfillment('pickup', row.pickup)}
                </dl>
                <div class="roaster-actions">
                    <a class="roaster-shop" href="${escapeHtml(row.shopUrl)}" rel="noopener">Shop beans<span class="visually-hidden"> from ${name}</span></a>
                    <a class="roaster-site" href="${escapeHtml(row.website)}" rel="noopener">Official website<span class="visually-hidden"> of ${name}</span></a>
                </div>
                <details class="roaster-sources">
                    <summary>Sources, checked <time datetime="${escapeHtml(row.checkedAt)}">${escapeHtml(formatDate(row.checkedAt))}</time><span class="visually-hidden"> for ${name}</span></summary>
                    <ul>${sources}
                    </ul>
                </details>
            </li>`;
}

/** schema.org ItemList of the listed roasters (name, site, locality only). */
function buildJsonLd(rows, pageUrl) {
    const graph = [
        {
            '@type': 'BreadcrumbList',
            itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/` },
                { '@type': 'ListItem', position: 2, name: 'Coffee roasters', item: pageUrl },
            ],
        },
        {
            '@type': 'CollectionPage',
            '@id': pageUrl,
            url: pageUrl,
            name: 'Local coffee roasters that sell beans',
            isPartOf: { '@type': 'WebSite', name: 'Local Coffee Shops', url: `${SITE_URL}/` },
            mainEntity: {
                '@type': 'ItemList',
                numberOfItems: rows.length,
                itemListElement: rows.map((row, i) => ({
                    '@type': 'ListItem',
                    position: i + 1,
                    item: {
                        '@type': 'Organization',
                        name: row.name,
                        url: row.website,
                        address: {
                            '@type': 'PostalAddress',
                            addressLocality: row.city,
                            addressRegion: row.state,
                            addressCountry: 'US',
                        },
                    },
                })),
            },
        },
    ];
    // Escape "<" so a stray "</script>" in any field can't end the tag.
    return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

const NAV_LINKS = [
    ['/', 'Home'],
    ['/pages/states/', 'Coffee shops by state'],
    ['/roasters/', 'Roasters'],
    ['/about.html', 'About'],
    ['/pages/contact.html', 'Contact'],
];

function renderNav() {
    const links = NAV_LINKS.map(([href, label]) =>
        `<li><a href="${href}"${href === PAGE_PATH ? ' aria-current="page"' : ''}>${label}</a></li>`).join('\n                ');
    return `<nav class="site-nav" aria-label="Main">
        <div class="container site-nav-inner">
            <a href="/" class="site-nav-logo">localcoffeeshops.co</a>
            <ul class="site-nav-links">
                ${links}
            </ul>
        </div>
    </nav>`;
}

/** The whole /roasters/ page for a validated dataset. */
function renderRoastersPage(data) {
    const rows = sortRows(data.roasters);
    const pageUrl = `${SITE_URL}${PAGE_PATH}`;
    const states = [...new Set(rows.map((r) => r.state))]
        .sort((a, b) => enums.stateName(a).localeCompare(enums.stateName(b)));
    const stateCount = (code) => rows.filter((r) => r.state === code).length;
    const stateNames = states.map((s) => enums.stateName(s));
    const stateList = stateNames.length > 1
        ? `${stateNames.slice(0, -1).join(', ')} and ${stateNames[stateNames.length - 1]}`
        : stateNames.join('');
    const options = states.map((code) =>
        `<option value="${escapeHtml(code)}">${escapeHtml(enums.stateName(code))} (${stateCount(code)})</option>`).join('\n                        ');
    const latest = rows.map((r) => r.checkedAt).sort().pop();
    const total = rows.length;
    const noun = (n) => `roaster${n === 1 ? '' : 's'}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
${renderHead({
        title: 'Local Coffee Roasters That Sell Beans | Local Coffee Shops',
        description: `A curated, non-exhaustive list of ${total} coffee ${noun(total)} in ${stateList} that sell packaged beans on their own websites, with sources and check dates.`,
        canonical: pageUrl,
        noindex: false,
    })}

    <!-- config.js gives the waitlist form its API URL. Google Consent Mode
         default is queued before gtag config (geo-consent-default.js, then
         analytics-init.js), after url-privacy.js has removed search text
         from the address bar; no inline scripts. -->
    <script src="/config.js"></script>
    <script src="/geo-consent-default.js"></script>
    <script src="/url-privacy.js"></script>
    <script src="/analytics-init.js"></script>
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-YVSXN7PM48"></script>
    <script defer src="/consent-banner.js"></script>
    <script defer src="/analytics-events.js"></script>
    <script defer src="/roasters.js"></script>
    <script defer src="/waitlist.js"></script>
    <script type="application/ld+json">${buildJsonLd(rows, pageUrl)}</script>
</head>
<body>
    <a href="#main-content" class="skip-link">Skip to main content</a>
    ${renderNav()}

    <main id="main-content" class="container roasters-page">
        <h1>Local coffee roasters that sell beans</h1>
        <p class="roasters-intro">Coffee roasters whose own websites sell packaged coffee beans. This is a first, curated collection from ${escapeHtml(stateList)}, part of a nationwide coffee directory.</p>
        <p class="coverage-notice" role="note">This list is not exhaustive: it currently covers ${total} ${noun(total)} in ${escapeHtml(stateList)} and will grow. Shipping and pickup are shown only where the roaster's own site says so; "Not confirmed" means we couldn't confirm it, not that it isn't offered. Check the roaster's site before ordering.</p>

        <form class="roaster-filters" id="roasterFilters" role="search" aria-label="Filter roasters" hidden>
            <div class="roaster-filter">
                <label for="roasterSearch">Search by name or city</label>
                <input type="search" id="roasterSearch" name="q" autocomplete="off" spellcheck="false">
            </div>
            <div class="roaster-filter">
                <label for="roasterState">State</label>
                <select id="roasterState" name="state">
                    <option value="">All states (${total})</option>
                        ${options}
                </select>
            </div>
            <button type="reset" class="roaster-reset">Clear filters</button>
        </form>

        <p class="roaster-status" id="roasterStatus" role="status" aria-live="polite">Showing all ${total} ${noun(total)}.</p>

        <section aria-labelledby="roasterListHeading">
            <h2 id="roasterListHeading" class="visually-hidden">Roasters</h2>
            <ul class="roaster-list" id="roasterList">
${rows.map(renderRow).join('\n')}
            </ul>
            <div class="roaster-empty" id="roasterEmpty" hidden>
                <p>No roasters match your search.</p>
                <button type="button" class="roaster-reset" id="roasterEmptyReset">Clear filters</button>
            </div>
        </section>

        ${renderWaitlistSection('roasters')}

        <section class="roaster-methodology" aria-labelledby="methodologyHeading">
            <h2 id="methodologyHeading">How this list is made</h2>
            <ul>
                <li>Every roaster here was checked against its own official website: where it is based, and a page on that site that sells packaged coffee beans. Each listing links to the pages we used and shows the date we checked them (most recently ${escapeHtml(formatDate(latest))}).</li>
                <li>We list shipping or local pickup only when the roaster's site states it. Otherwise it says "Not confirmed".</li>
                <li>We don't list prices, products, ratings or opening hours, which change often. The roaster's site is the place to check them.</li>
                <li>We don't sell coffee or take orders; the links go straight to each roaster.</li>
                <li>Coverage starts with Massachusetts and nearby New England states and is not complete. Know a roaster we should check, or spot a mistake? <a href="/pages/contact.html">Let us know</a>.</li>
            </ul>
            <p>Looking for a café instead? <a href="/pages/states/">Browse coffee shops by state</a>.</p>
        </section>
    </main>
</body>
</html>
`;
}

function loadRoasters(file = DATA_PATH) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Validate, then (unless checkOnly) write the page. Throws on invalid data so
 * the build fails instead of publishing it.
 */
function main({ checkOnly = false, dataPath = DATA_PATH, outFile = OUT_FILE, log = console, today } = {}) {
    const data = loadRoasters(dataPath);
    const { errors, warnings, rows } = validateRoasters(data, today ? { today } : {});
    for (const w of warnings) log.warn(`⚠️  ${w}`);
    if (errors.length) {
        throw new Error(`${path.relative(ROOT, dataPath)} has ${errors.length} problem(s):\n  - ${errors.join('\n  - ')}`);
    }
    const summary = summarize(rows);
    const states = Object.entries(summary.byState).sort().map(([s, n]) => `${s} ${n}`).join(', ');
    if (!checkOnly) {
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, renderRoastersPage(data));
    }
    log.log(`✅ ${summary.total} roasters valid (${states}; shipping confirmed ${summary.shippingOffered}, pickup confirmed ${summary.pickupOffered}, ${summary.sources} sources)`
        + (checkOnly ? '' : ` -> ${path.relative(process.cwd(), outFile)}`));
    return summary;
}

module.exports = {
    DATA_PATH,
    OUT_FILE,
    PAGE_PATH,
    formatDate,
    searchText,
    sourceLabel,
    sortRows,
    safeHttpsUrl,
    validateRoasters,
    summarize,
    loadRoasters,
    renderRoastersPage,
    main,
};

if (require.main === module) {
    try {
        main({ checkOnly: process.argv.includes('--check') });
    } catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
    }
}
