/**
 * State Page JavaScript
 * Coffee shop listing for individual state pages
 * @module state
 */

// Use shared constants and utilities
const { STATE_NAMES, getPriceLevelClass, formatPriceLevel, calculateAveragePrice, isValidStateCode, createSkeletonItem } = CoffeeShopConstants;

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

// Note: createSkeletonItem is imported from CoffeeShopConstants (constants.js)

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

// API Configuration
const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '/api/v1';

// Frontend base URL for meta tags and canonical URLs
let frontendBaseUrl = window.location.origin;

/**
 * Load backend configuration to get canonical frontend URL
 * Called early in initialization to set correct base URL for meta tags
 */
async function loadBackendConfig() {
    try {
        const response = await fetch(`${API_BASE_URL}/config`);
        const config = await response.json();
        if (config.frontendUrl) {
            frontendBaseUrl = config.frontendUrl;
        }
    } catch (error) {
        console.warn('Could not load backend config, using window.location.origin');
    }
}

/** @constant {number} Timeout for API requests in milliseconds */
const FETCH_TIMEOUT_MS = 10000;

/** @constant {number} Maximum number of retry attempts for failed requests */
const MAX_RETRIES = 3;

/** @constant {number} Base delay between retries in milliseconds (exponential backoff) */
const RETRY_DELAY_MS = 1000;

/**
 * Delay execution for a specified time
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>} Promise that resolves after the delay
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error or response should trigger a retry
 * @param {Error|null} error - The error object to check
 * @param {Response|null} [response=null] - The fetch response to check
 * @returns {boolean} True if the error/response is retryable
 */
function isRetryableError(error, response = null) {
    if (error && (error.name === 'AbortError' || error.message.includes('timeout'))) {
        return true;
    }
    if (error && error.name === 'TypeError' && error.message.includes('fetch')) {
        return true;
    }
    if (response && (response.status >= 500 || response.status === 429)) {
        return true;
    }
    return false;
}

/**
 * Fetch with timeout and automatic retry support
 * Uses exponential backoff for retries on server errors or timeouts
 * @param {string} url - The URL to fetch
 * @param {number} [timeout=FETCH_TIMEOUT_MS] - Request timeout in milliseconds
 * @param {number} [retries=MAX_RETRIES] - Number of remaining retry attempts
 * @returns {Promise<Response>} The fetch response
 * @throws {Error} When all retries are exhausted or non-retryable error occurs
 */
async function fetchWithTimeout(url, timeout = FETCH_TIMEOUT_MS, retries = MAX_RETRIES) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, { signal: controller.signal });

        // Check for server errors that should trigger retry
        if (!response.ok && isRetryableError(null, response) && retries > 0) {
            clearTimeout(timeoutId);
            const retryDelay = RETRY_DELAY_MS * Math.pow(2, MAX_RETRIES - retries);
            console.warn(`Request failed with ${response.status}, retrying in ${retryDelay}ms...`);
            await delay(retryDelay);
            return fetchWithTimeout(url, timeout, retries - 1);
        }

        return response;
    } catch (error) {
        clearTimeout(timeoutId);

        // Check if error is retryable
        if (isRetryableError(error) && retries > 0) {
            const retryDelay = RETRY_DELAY_MS * Math.pow(2, MAX_RETRIES - retries);
            console.warn(`Request failed: ${error.message}, retrying in ${retryDelay}ms...`);
            await delay(retryDelay);
            return fetchWithTimeout(url, timeout, retries - 1);
        }

        if (error.name === 'AbortError') {
            throw new Error('Request timed out. Please try again.');
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
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
    if (!isValidStateCode(stateCode)) {
        document.getElementById('pageTitle').textContent = 'Invalid State';
        document.getElementById('totalShops').textContent = '-';
        document.getElementById('avgPrice').textContent = '-';
        showError('Invalid or missing state code. Please select a state from the home page.');
        document.title = 'Invalid State - Coffee Shops';
        return;
    }

    const stateName = STATE_NAMES[stateCode];

    // Update page title and heading
    document.title = `Coffee Shops in ${stateName} | Local Coffee Shops`;
    document.getElementById('pageTitle').textContent = `Coffee Shops in ${stateName}`;

    // Load backend config to get canonical frontend URL
    await loadBackendConfig();

    // Update meta tags for SEO
    updateMetaTags(stateName, stateCode);

    // Show skeleton loading
    showSkeletonLoading();

    try {
        const response = await fetchWithTimeout(`${API_BASE_URL}/states/${stateCode}`);

        // Validate response
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        // Validate response format
        if (!result || (result.success === false)) {
            throw new Error(result?.error?.message || 'Invalid API response');
        }

        const coffeeShops = Array.isArray(result) ? result : (result.data || []);

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

        // Update average price level using shared function
        avgPrice.textContent = calculateAveragePrice(coffeeShops);

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
                const span = document.createElement('span');
                // Use shared functions for price level
                span.className = 'price-level ' + getPriceLevelClass(shop.priceLevel);
                span.textContent = formatPriceLevel(shop.priceLevel);
                // Add aria-label for screen readers
                span.setAttribute('aria-label', 'Price level: ' + formatPriceLevel(shop.priceLevel));
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
