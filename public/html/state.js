/**
 * State Page JavaScript
 * Coffee shop listing for individual state pages
 * @module state
 */

// Hard dep on enums + skeleton + api-client + store — fail loud if missing
// (script order is enforced by asset-loader-state.js).
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

// Per-page store (ADR-0001): three keys cover all the state-detail view's
// reactive surface.
//   - shops:   the list rendered into <ul id="coffeeList"> (null = unloaded)
//   - loading: skeleton-loading toggle
//   - error:   user-facing error message (null when no error)
//
// `shops` starts as null (not []) so that a successful empty-result load
// still notifies subscribers (null → [] is a real change; [] → [] is not).
const store = createStore({
    shops: null,
    loading: false,
    error: null
});

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
    const url = `${frontendBaseUrl}/html/state.html?code=${stateCode}`;
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

/**
 * Render the shops list + the summary stats (total + avg price).
 * Triggered by store.subscribe('shops', renderShops). `shops` is null
 * before the first successful load.
 */
function renderShops(shops) {
    if (shops == null) return;

    const coffeeList = document.getElementById('coffeeList');
    const totalShops = document.getElementById('totalShops');
    const avgPrice = document.getElementById('avgPrice');

    coffeeList.textContent = '';
    totalShops.textContent = shops.length;
    avgPrice.textContent = Price.average(shops.map(s => Price.fromKey(s.priceLevel))).label;

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

// Wire subscribers — see ADR-0001 for the rationale on explicit per-key subscriptions.
store.subscribe('shops', renderShops);
store.subscribe('loading', toggleSkeletonLoading);
store.subscribe('error', showOrHideError);

/**
 * Fetch coffee shops for `stateCode`, pushing results into the store.
 * Renderers react via subscribers.
 */
async function loadStateShops(stateCode) {
    store.set('loading', true);
    store.set('error', null);
    try {
        const data = await api.get(`/states/${stateCode}`);
        const coffeeShops = Array.isArray(data) ? data : [];
        if (!Array.isArray(coffeeShops)) {
            throw new Error('Invalid data format received from API');
        }
        store.set('shops', coffeeShops);
    } catch (err) {
        console.error('Error loading coffee shops:', err);
        store.set('error', 'Error loading coffee shops. Please try again later.');
    } finally {
        store.set('loading', false);
    }
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

    await loadStateShops(stateCode);
}

// Initialize the page
document.addEventListener('DOMContentLoaded', loadCoffeeShops);
