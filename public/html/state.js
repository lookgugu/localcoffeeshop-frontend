/**
 * State Page JavaScript
 * Coffee shop listing for individual state pages
 * @module state
 */

// Hard dep on enums + skeleton + api-client + store — fail loud if missing
// (they're bundled ahead of this file in /dist/state.bundle.min.js, scripts/build-js.cjs).
if (!window.CoffeeShopEnums) {
    throw new Error('window.CoffeeShopEnums not loaded — check script order in HTML');
}
if (!window.CoffeeShopSkeleton) {
    throw new Error('window.CoffeeShopSkeleton not loaded — check script order in HTML');
}
if (!window.ApiClient) {
    throw new Error('window.ApiClient not loaded — check script order in HTML');
}
if (!window.CoffeeShopStore) {
    throw new Error('window.CoffeeShopStore not loaded — check script order in HTML');
}
const { stateName, isStateCode, Price } = window.CoffeeShopEnums;
const { createSkeletonItem } = window.CoffeeShopSkeleton;
const api = window.ApiClient;
const { createStore } = window.CoffeeShopStore;

// Shops requested per API page. The API defaults to 100 and caps at 500.
// We load one page up front and fetch further pages on demand ("Load more"):
// the largest state has ~2,560 shops, and the prerendered static page already
// lists every shop for crawlers and no-JS visitors.
const PAGE_SIZE = 100;

// Per-page store (ADR-0001): the state-detail view's reactive surface.
//   - shops:         the loaded shops rendered into <ul id="coffeeList"> (null = unloaded)
//   - pagination:    { page, total, hasNext, rejected } for what has been loaded
//                    (null = unloaded). `total` is the displayed total: the
//                    server count minus `rejected` (duplicates skipped across
//                    pages), or exactly the loaded count once there are no more pages.
//   - loading:       skeleton-loading toggle (first page)
//   - loadingMore:   a "Load more" request is in flight
//   - error:         user-facing error message for the first page (null when no error)
//   - loadMoreError: user-facing error for a failed "Load more" (null when none)
//
// `shops` starts as null (not []) so that a successful empty-result load
// still notifies subscribers (null → [] is a real change; [] → [] is not).
const store = createStore({
    shops: null,
    pagination: null,
    loading: false,
    loadingMore: false,
    error: null,
    loadMoreError: null
});

// shop object -> its rendered <li>, rebuilt on each render; used to move focus
// to the first newly loaded shop after "Load more".
let shopElements = new Map();

/**
 * Display an error message in the coffee list
 * @param {string} message - The error message to display
 */
function showError(message) {
    const coffeeList = document.getElementById('coffeeList');
    coffeeList.textContent = '';
    const li = document.createElement('li');
    li.className = 'coffee-item error';
    li.textContent = message;
    coffeeList.appendChild(li);
}

// Note: createSkeletonItem is imported from window.CoffeeShopSkeleton (skeleton.js)

/**
 * Show skeleton loading state with accessible loading announcement
 * Displays 10 skeleton items while data is being fetched
 */
function showSkeletonLoading() {
    const coffeeList = document.getElementById('coffeeList');
    coffeeList.textContent = '';

    // Add screen reader announcement
    const srText = document.createElement('li');
    srText.className = 'visually-hidden';
    srText.setAttribute('role', 'status');
    srText.setAttribute('aria-live', 'polite');
    srText.textContent = 'Loading coffee shops...';
    coffeeList.appendChild(srText);

    // Add skeleton items
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 10; i++) {
        fragment.appendChild(createSkeletonItem());
    }
    coffeeList.appendChild(fragment);
}

/**
 * Hide skeleton loading state and remove all skeleton elements
 */
function hideSkeletonLoading() {
    const coffeeList = document.getElementById('coffeeList');
    const skeletons = coffeeList.querySelectorAll('.skeleton-item, .visually-hidden[role="status"]');
    skeletons.forEach(s => s.remove());
}

/**
 * Get state code from URL query parameters
 * @returns {string|null} Two-letter state code (uppercase) or null if not found
 */
function getStateCode() {
    const params = new URLSearchParams(window.location.search);
    return params.get('code')?.toUpperCase() || null;
}

/**
 * Update meta tags for SEO when state data is loaded
 * @param {string} stateName - Full state name (e.g., "California")
 * @param {string} stateCode - Two-letter state code (e.g., "CA")
 */
function updateMetaTags(stateName, stateCode) {
    const description = `Discover the best coffee shops in ${stateName}. Browse local cafes, compare prices, and find your next favorite coffee spot.`;
    const url = canonicalStateUrl(stateCode);
    const title = `Coffee Shops in ${stateName}`;

    // Update meta description
    const metaDesc = document.getElementById('metaDescription');
    if (metaDesc) metaDesc.setAttribute('content', description);

    // Update canonical URL
    const canonical = document.getElementById('canonicalUrl');
    if (canonical) canonical.setAttribute('href', url);

    // Update Open Graph tags
    const ogUrl = document.getElementById('ogUrl');
    if (ogUrl) ogUrl.setAttribute('content', url);

    const ogTitle = document.getElementById('ogTitle');
    if (ogTitle) ogTitle.setAttribute('content', title);

    const ogDesc = document.getElementById('ogDescription');
    if (ogDesc) ogDesc.setAttribute('content', description);

    // Update Twitter Card tags
    const twitterTitle = document.getElementById('twitterTitle');
    if (twitterTitle) twitterTitle.setAttribute('content', title);

    const twitterDesc = document.getElementById('twitterDescription');
    if (twitterDesc) twitterDesc.setAttribute('content', description);
}

// Frontend base URL for meta tags and canonical URLs
let frontendBaseUrl = window.location.origin;

/**
 * Slug for a state's static page: 'NY' -> 'new-york', 'DC' -> 'washington-d-c'.
 * Must match stateSlug() in scripts/prerender-states.cjs, which writes the
 * pages (a test checks they agree). Not in enums.js, which has to stay
 * identical to the backend repo's copy.
 * @param {string} stateCode - Two-letter state code (e.g. "CA")
 * @returns {string}
 */
function stateSlug(stateCode) {
    return stateName(stateCode)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Canonical URL for a state: the build-time prerendered static page, which
 * carries the same listings and JSON-LD without needing JavaScript.
 * @param {string} stateCode - Two-letter state code (e.g. "CA")
 * @returns {string}
 */
function canonicalStateUrl(stateCode) {
    return `${frontendBaseUrl}/pages/states/${stateSlug(stateCode)}.html`;
}

/**
 * Load backend configuration to get canonical frontend URL
 * Called early in initialization to set correct base URL for meta tags
 */
async function loadBackendConfig() {
    try {
        const config = await api.get('/config');
        if (config && config.frontendUrl) {
            frontendBaseUrl = config.frontendUrl;
        }
    } catch (error) {
        console.warn('Could not load backend config, using window.location.origin');
    }
}

// ============================================================================
// RENDERERS — wired to the store via per-key subscribers below.
// Each renderer reads only the key it subscribes to.
// ============================================================================

/** Format a count for display: 1240 -> "1,240". */
function formatCount(n) {
    return Number(n).toLocaleString('en-US');
}

/**
 * Render the summary stats: the state's real total (from API pagination
 * metadata) and the average price level. The average can only be computed
 * over shops we have loaded, so when that is a subset it says so.
 * Triggered by store.subscribe('shops' | 'pagination', renderSummary).
 */
function renderSummary() {
    const shops = store.get('shops');
    const pagination = store.get('pagination');
    if (shops == null || pagination == null) return;

    const total = Math.max(pagination.total, shops.length);
    document.getElementById('totalShops').textContent = formatCount(total);

    const avg = Price.average(shops.map(s => Price.fromKey(s.priceLevel))).label;
    document.getElementById('avgPrice').textContent = shops.length < total
        ? `${avg} (based on the ${formatCount(shops.length)} shops loaded so far)`
        : avg;
}

/**
 * Render the shops list.
 * Triggered by store.subscribe('shops', renderShops). `shops` is null
 * before the first successful load.
 */
function renderShops(shops) {
    if (shops == null) return;

    const coffeeList = document.getElementById('coffeeList');

    coffeeList.textContent = '';
    shopElements = new Map();

    if (shops.length === 0) {
        // Empty-after-load is a UX concern, not an error — but the existing
        // contract used showError() to surface it. Preserve that.
        if (!store.get('loading') && store.get('error') === null) {
            showError('No coffee shops found in this state.');
        }
        return;
    }

    // Sort shops by name (stable copy — never mutate the store value).
    const sorted = shops.slice().sort((a, b) => {
        const nameA = a.displayName?.text || '';
        const nameB = b.displayName?.text || '';
        return nameA.localeCompare(nameB);
    });

    const fragment = document.createDocumentFragment();
    sorted.forEach(shop => {
        const li = document.createElement('li');
        li.className = 'coffee-item';

        const h3 = document.createElement('h3');
        h3.textContent = shop.displayName?.text || 'Unknown';
        li.appendChild(h3);

        const p = document.createElement('p');
        p.textContent = shop.formattedAddress || '';
        li.appendChild(p);

        if (shop.priceLevel) {
            const priceInfo = Price.fromKey(shop.priceLevel);
            const priceLabel = priceInfo.label.toLowerCase();
            const span = document.createElement('span');
            span.className = 'price-level ' + priceInfo.cssClass;
            span.textContent = priceLabel;
            span.setAttribute('aria-label', 'Price level: ' + priceLabel);
            li.appendChild(span);
        }

        shopElements.set(shop, li);
        fragment.appendChild(li);
    });
    coffeeList.appendChild(fragment);
}

/**
 * Toggle skeleton loading visibility.
 * Triggered by store.subscribe('loading', toggleSkeletonLoading).
 */
function toggleSkeletonLoading(isLoading) {
    if (isLoading) {
        showSkeletonLoading();
    } else {
        hideSkeletonLoading();
    }
}

/**
 * Show or hide the user-facing error message.
 * Triggered by store.subscribe('error', showOrHideError).
 */
function showOrHideError(message) {
    if (message) {
        document.getElementById('totalShops').textContent = '-';
        document.getElementById('avgPrice').textContent = '-';
        showError(message);
    }
    // No "hide" action: a successful render replaces the list contents in
    // renderShops, which clears any prior error <li>.
}

/**
 * Get (creating on first use) the "Load more" controls that sit after the
 * list: a polite live region with the "Showing X of Y" count, an alert for
 * load-more failures, and the button itself. Built in JS so the page markup
 * doesn't need to change.
 */
function getLoadMoreControls() {
    let container = document.getElementById('loadMoreControls');
    if (!container) {
        container = document.createElement('div');
        container.id = 'loadMoreControls';
        container.className = 'load-more-controls';
        container.hidden = true;

        const status = document.createElement('p');
        status.id = 'shopListStatus';
        status.className = 'result-count';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        container.appendChild(status);

        const errorMsg = document.createElement('p');
        errorMsg.id = 'loadMoreError';
        errorMsg.className = 'error';
        errorMsg.setAttribute('role', 'alert');
        errorMsg.hidden = true;
        container.appendChild(errorMsg);

        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'loadMoreShops';
        button.className = 'load-more';
        button.setAttribute('aria-controls', 'coffeeList');
        button.addEventListener('click', () => {
            loadMoreShops().catch(err => console.error('Error loading more coffee shops:', err));
        });
        container.appendChild(button);

        document.getElementById('coffeeList').after(container);
    }
    return {
        container,
        status: container.querySelector('#shopListStatus'),
        errorMsg: container.querySelector('#loadMoreError'),
        button: container.querySelector('#loadMoreShops')
    };
}

/**
 * Render the "Showing X of Y" status and the "Load more" button.
 * Triggered by store.subscribe('shops' | 'pagination' | 'loadingMore' |
 * 'loadMoreError', renderLoadMore).
 */
function renderLoadMore() {
    const shops = store.get('shops');
    const pagination = store.get('pagination');
    const loadingMore = store.get('loadingMore');
    const loadMoreError = store.get('loadMoreError');

    const multiPage = shops != null && pagination != null && shops.length > 0
        && (pagination.hasNext || pagination.page > 1);
    const existing = document.getElementById('loadMoreControls');
    if (!multiPage) {
        if (existing) existing.hidden = true;
        return;
    }

    const { container, status, errorMsg, button } = getLoadMoreControls();
    container.hidden = false;

    const total = Math.max(pagination.total, shops.length);
    status.textContent = pagination.hasNext
        ? `Showing ${formatCount(shops.length)} of ${formatCount(total)} coffee shops`
        : `Showing all ${formatCount(shops.length)} coffee shops`;

    errorMsg.hidden = !loadMoreError;
    errorMsg.textContent = loadMoreError || '';

    document.getElementById('coffeeList').setAttribute('aria-busy', loadingMore ? 'true' : 'false');

    if (!pagination.hasNext) {
        button.hidden = true;
        return;
    }
    const remaining = Math.max(total - shops.length, 0);
    const nextBatch = Math.min(PAGE_SIZE, remaining);
    button.hidden = false;
    button.disabled = loadingMore;
    if (loadingMore) {
        button.textContent = 'Loading more coffee shops...';
        button.setAttribute('aria-label', 'Loading more coffee shops');
    } else {
        button.textContent = `Load more (${formatCount(remaining)} remaining)`;
        button.setAttribute('aria-label', `Load ${formatCount(nextBatch)} more coffee shops, ${formatCount(remaining)} remaining`);
    }
}

// Wire subscribers — see ADR-0001 for the rationale on explicit per-key subscriptions.
store.subscribe('shops', renderShops);
store.subscribe('shops', renderSummary);
store.subscribe('pagination', renderSummary);
store.subscribe('shops', renderLoadMore);
store.subscribe('pagination', renderLoadMore);
store.subscribe('loadingMore', renderLoadMore);
store.subscribe('loadMoreError', renderLoadMore);
store.subscribe('loading', toggleSkeletonLoading);
store.subscribe('error', showOrHideError);

// State code of the loaded list; "Load more" fetches further pages of it.
let currentStateCode = null;

/**
 * Fetch one page of a state's shops. Returns the shops and normalised
 * pagination. When the API omits pagination metadata, the page is treated
 * as the whole list.
 */
async function fetchShopsPage(stateCode, page) {
    const result = await api.get(`/states/${stateCode}`, {
        query: { page, limit: PAGE_SIZE },
        withMeta: true
    });
    // An older cached ApiClient (pre-withMeta) returns the bare array; treat
    // that as a single page with no pagination metadata.
    const { data, metadata } = Array.isArray(result)
        ? { data: result, metadata: null }
        : (result || {});
    if (!Array.isArray(data)) {
        throw new Error('Invalid data format received from API');
    }
    const p = metadata && metadata.pagination;
    const pagination = p && typeof p.total === 'number'
        ? { page: p.page || page, total: p.total, hasNext: Boolean(p.hasNext) }
        : { page, total: data.length, hasNext: false };
    return { shops: data, pagination };
}

/**
 * Total to display. The server's count includes records we skip as
 * duplicates across pages, so subtract those; once there are no more pages
 * the total is exactly what was loaded, so the final state never shows a
 * phantom remainder.
 */
function reconcileTotal(serverTotal, rejected, loaded, hasNext) {
    if (!hasNext) return loaded;
    return Math.max(serverTotal - rejected, loaded);
}

/**
 * Fetch the first page of coffee shops for `stateCode`, pushing results into
 * the store. Renderers react via subscribers.
 */
async function loadStateShops(stateCode) {
    currentStateCode = stateCode;
    store.set('loading', true);
    store.set('error', null);
    store.set('loadMoreError', null);
    try {
        const { shops, pagination } = await fetchShopsPage(stateCode, 1);
        // Clear loading before rendering: renderShops only shows the empty
        // state once loading is over.
        store.set('loading', false);
        // Pagination first: renderSummary/renderLoadMore run on each write and
        // need both keys; the 'shops' write is the one that renders the list.
        store.set('pagination', {
            ...pagination,
            total: reconcileTotal(pagination.total, 0, shops.length, pagination.hasNext),
            rejected: 0
        });
        store.set('shops', shops);
    } catch (err) {
        console.error('Error loading coffee shops:', err);
        store.set('error', 'Error loading coffee shops. Please try again later.');
    } finally {
        store.set('loading', false);
    }
}

/**
 * Fetch the next page and append it to the loaded shops. On failure the
 * already-loaded shops stay and the button stays available to retry.
 */
async function loadMoreShops() {
    const pagination = store.get('pagination');
    if (store.get('loadingMore') || !pagination || !pagination.hasNext || !currentStateCode) return;

    store.set('loadMoreError', null);
    store.set('loadingMore', true);
    try {
        const next = await fetchShopsPage(currentStateCode, pagination.page + 1);
        // Skip shops already loaded (data can shift between page requests).
        const loaded = store.get('shops') || [];
        const seen = new Set(loaded.map(s => s.id).filter(id => id != null));
        const fresh = next.shops.filter(s => s.id == null || !seen.has(s.id));
        // Duplicates were counted in the server total but won't be shown.
        const rejected = (pagination.rejected || 0) + (next.shops.length - fresh.length);
        const hasNext = next.pagination.hasNext && next.shops.length > 0;

        store.set('pagination', {
            ...next.pagination,
            hasNext,
            rejected,
            total: reconcileTotal(next.pagination.total, rejected, loaded.length + fresh.length, hasNext)
        });
        store.update('shops', prev => (prev || []).concat(fresh));

        // Move focus to the first newly loaded shop so keyboard and screen
        // reader users continue from where the new content starts.
        const firstNew = fresh.length ? shopElements.get(fresh[0]) : null;
        if (firstNew) {
            firstNew.setAttribute('tabindex', '-1');
            firstNew.focus();
        }
    } catch (err) {
        console.error('Error loading more coffee shops:', err);
        store.set('loadMoreError', 'Could not load more coffee shops. Please try again.');
    } finally {
        store.set('loadingMore', false);
    }
}

/**
 * Map a price-level enum to a schema.org priceRange string ($, $$, $$$).
 * @param {string} priceLevel - Price level key from the API
 * @returns {string|null} priceRange string, or null when unknown
 */
function priceRangeSymbol(priceLevel) {
    if (!priceLevel) return null;
    const priceInfo = Price.fromKey(priceLevel);
    const numeric = priceInfo && typeof priceInfo.numeric === 'number' ? priceInfo.numeric : 0;
    return numeric > 0 ? '$'.repeat(numeric) : null;
}

/**
 * Inject (or replace) a JSON-LD structured-data block describing this state's
 * coffee-shop listing. Emits a @graph with:
 *   - BreadcrumbList (Home > Coffee Shops in {state})
 *   - CollectionPage about the state (AdministrativeArea), whose mainEntity is
 *     an ItemList of the loaded shops as CafeOrCoffeeShop items.
 *
 * This gives search engines and AI answer engines that render the page rich,
 * machine-readable context about which shops are listed for the state.
 *
 * @param {string} fullStateName - e.g. "California"
 * @param {string} stateCode - two-letter code, e.g. "CA"
 * @param {Array<Object>} shops - loaded shop records (may be empty)
 */
function injectStructuredData(fullStateName, stateCode, shops) {
    const pageUrl = canonicalStateUrl(stateCode);
    const list = Array.isArray(shops) ? shops : [];

    const itemListElement = list.map((shop, i) => {
        const business = {
            '@type': 'CafeOrCoffeeShop',
            name: shop.displayName?.text || 'Coffee shop',
            address: shop.formattedAddress || undefined,
            areaServed: fullStateName
        };
        const priceRange = priceRangeSymbol(shop.priceLevel);
        if (priceRange) business.priceRange = priceRange;
        return {
            '@type': 'ListItem',
            position: i + 1,
            item: business
        };
    });

    const graph = [
        {
            '@type': 'BreadcrumbList',
            itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: `${frontendBaseUrl}/` },
                { '@type': 'ListItem', position: 2, name: `Coffee Shops in ${fullStateName}`, item: pageUrl }
            ]
        },
        {
            '@type': 'CollectionPage',
            '@id': pageUrl,
            url: pageUrl,
            name: `Coffee Shops in ${fullStateName}`,
            description: `Discover local coffee shops in ${fullStateName}. Browse cafes, compare price levels, and find your next favorite coffee spot.`,
            isPartOf: {
                '@type': 'WebSite',
                name: 'Local Coffee Shops',
                url: `${frontendBaseUrl}/`
            },
            about: {
                '@type': 'AdministrativeArea',
                name: fullStateName,
                containedInPlace: { '@type': 'Country', name: 'United States' }
            },
            mainEntity: {
                '@type': 'ItemList',
                name: `Coffee shops in ${fullStateName}`,
                numberOfItems: itemListElement.length,
                itemListElement
            }
        }
    ];

    const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })
        // Prevent a stray "</script>" in any field from terminating the tag.
        .replace(/</g, '\\u003c');

    let script = document.getElementById('stateJsonLd');
    if (!script) {
        script = document.createElement('script');
        script.type = 'application/ld+json';
        script.id = 'stateJsonLd';
        document.head.appendChild(script);
    }
    script.textContent = json;
}

/**
 * Page entry point: validate URL params, update title/meta, then fetch.
 * Rendering is handled by store subscribers.
 */
async function loadCoffeeShops() {
    const stateCode = getStateCode();

    // Validate state code using shared function
    if (!isStateCode(stateCode)) {
        document.getElementById('pageTitle').textContent = 'Invalid State';
        document.getElementById('totalShops').textContent = '-';
        document.getElementById('avgPrice').textContent = '-';
        showError('Invalid or missing state code. Please select a state from the home page.');
        document.title = 'Invalid State - Coffee Shops';
        return;
    }

    const fullStateName = stateName(stateCode);

    // Update page title and heading
    document.title = `Coffee Shops in ${fullStateName} | Local Coffee Shops`;
    document.getElementById('pageTitle').textContent = `Coffee Shops in ${fullStateName}`;

    // Load backend config to get canonical frontend URL
    await loadBackendConfig();

    // Update meta tags for SEO
    updateMetaTags(fullStateName, stateCode);

    // Emit baseline structured data immediately (breadcrumb + collection page)
    // so it is present even if the shop fetch is slow or fails.
    injectStructuredData(fullStateName, stateCode, []);

    await loadStateShops(stateCode);

    // Re-emit with the loaded shop list now populated as an ItemList.
    injectStructuredData(fullStateName, stateCode, store.get('shops') || []);
}

// Initialize the page. The state bundle loads with <script defer>, so the DOM
// is already parsed here (readyState 'interactive'); if this script is ever
// run some other way after DOMContentLoaded has fired, a listener would never
// fire, so run immediately unless the document is still loading.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadCoffeeShops);
} else {
    loadCoffeeShops();
}
