/**
 * State Page JavaScript
 * Coffee shop listing for individual state pages
 * @module state
 */

// Hard dep on enums + skeleton + api-client — fail loud if missing
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
const { stateName, isStateCode, Price } = window.CoffeeShopEnums;
const { createSkeletonItem } = window.CoffeeShopSkeleton;
const api = window.ApiClient;

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

/**
 * Load and display coffee shops for the current state
 * Main entry point that handles validation, API fetching, and rendering
 * @returns {Promise<void>}
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

    // Show skeleton loading
    showSkeletonLoading();

    try {
        const data = await api.get(`/states/${stateCode}`);
        const coffeeShops = Array.isArray(data) ? data : [];

        // Validate that we have an array
        if (!Array.isArray(coffeeShops)) {
            throw new Error('Invalid data format received from API');
        }

        // Hide skeleton loading
        hideSkeletonLoading();

        const coffeeList = document.getElementById('coffeeList');
        const totalShops = document.getElementById('totalShops');
        const avgPrice = document.getElementById('avgPrice');

        // Update total shops count
        totalShops.textContent = coffeeShops.length;

        // Update average price level via the Price typed enum
        avgPrice.textContent = Price.average(coffeeShops.map(s => Price.fromKey(s.priceLevel))).label;

        // Handle empty results
        if (coffeeShops.length === 0) {
            showError('No coffee shops found in this state.');
            return;
        }

        // Sort shops by name
        coffeeShops.sort((a, b) => {
            const nameA = a.displayName?.text || '';
            const nameB = b.displayName?.text || '';
            return nameA.localeCompare(nameB);
        });

        // Display each coffee shop
        coffeeShops.forEach(shop => {
            const li = document.createElement('li');
            li.className = 'coffee-item';

            // Create elements safely using textContent (prevents XSS)
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
                // Add aria-label for screen readers
                span.setAttribute('aria-label', 'Price level: ' + priceLabel);
                li.appendChild(span);
            }

            coffeeList.appendChild(li);
        });
    } catch (error) {
        console.error('Error loading coffee shops:', error);
        hideSkeletonLoading();
        document.getElementById('totalShops').textContent = '-';
        document.getElementById('avgPrice').textContent = '-';
        showError('Error loading coffee shops. Please try again later.');
    }
}

// Initialize the page
document.addEventListener('DOMContentLoaded', loadCoffeeShops);
