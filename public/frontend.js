// Coffee Shop Directory Application
// Wrapped in IIFE to avoid global namespace pollution
(function() {
    'use strict';

    // ============================================================================
    // CONSTANTS (uses shared enums from enums.js)
    // ============================================================================

    // Hard dep on enums — fail loud if missing instead of silently falling back to
    // a stale local copy (the previous bug class this refactor was designed to kill).
    if (!window.CoffeeShopEnums) {
        throw new Error('window.CoffeeShopEnums not loaded — check script order in HTML');
    }
    if (!window.CoffeeShopSkeleton) {
        throw new Error('window.CoffeeShopSkeleton not loaded — check script order in HTML');
    }
    const Enums = window.CoffeeShopEnums;
    const { stateName, isStateCode, Price } = Enums;
    const { createSkeletonItem } = window.CoffeeShopSkeleton;

    const CONSTANTS = {
        // API Configuration
        API_BASE_URL: window.APP_CONFIG?.API_BASE_URL || '/api/v1',

        // Performance Settings
        SEARCH_DEBOUNCE_MS: 300,
        IDLE_CALLBACK_TIMEOUT_MS: 5000,
        IDLE_CALLBACK_FALLBACK_MIN_MS: 1000,
        IDLE_CALLBACK_FALLBACK_MAX_MS: 4000,

        // Pagination
        SEARCH_RESULTS_PER_PAGE: 50,
        LOAD_MORE_BATCH_SIZE: 50,

        // Cache Settings
        CACHE_DURATION_MS: 3600000, // 1 hour

        // Network Settings
        FETCH_TIMEOUT_MS: 10000, // 10 second timeout for API requests
        INIT_TIMEOUT_MS: 30000,  // 30 second timeout for full initialization
        MAX_RETRIES: 3,          // Maximum number of retry attempts
        RETRY_DELAY_MS: 1000     // Base delay between retries (exponential backoff)
    };

    // ============================================================================
    // STATE
    // ============================================================================

    // State management limits to prevent memory issues
    const STATE_LIMITS = {
        MAX_CACHE_SIZE: 100,        // Max number of cached state data entries
        MAX_LOADING_STATES: 10,     // Max concurrent loading requests
        MAX_RESULTS_ELEMENTS: 1000  // Max DOM elements to track
    };

    const state = {
        dataCache: new Map(),
        loadingStates: new Set(), // Track in-progress state data requests
        availableStates: [],
        searchTimeout: null,
        lastSearchResults: null,
        resultsElements: [],
        // Load more pagination state
        loadMoreState: {
            shops: [],
            currentlyShowing: 0
        },
        // DOM element cache
        dom: {
            searchResultsContainer: null,
            stateGrid: null,
            searchInput: null,
            stateFilter: null,
            priceFilter: null
        },
        // Cached layout values for performance
        gridColumns: null,
        resizeTimeout: null
    };

    // State management utilities
    const stateUtils = {
        // Add to cache with size limit enforcement
        setCacheEntry(key, value) {
            // Evict oldest entry if at limit
            if (state.dataCache.size >= STATE_LIMITS.MAX_CACHE_SIZE && !state.dataCache.has(key)) {
                const firstKey = state.dataCache.keys().next().value;
                state.dataCache.delete(firstKey);
            }
            state.dataCache.set(key, value);
        },

        // Add to loading states with limit check
        addLoadingState(stateCode) {
            if (state.loadingStates.size >= STATE_LIMITS.MAX_LOADING_STATES) {
                // Clear oldest loading states if stuck
                console.warn('Too many loading states, clearing oldest');
                const firstState = state.loadingStates.values().next().value;
                state.loadingStates.delete(firstState);
            }
            state.loadingStates.add(stateCode);
        },

        // Clean up stale loading states (older than 30 seconds)
        cleanupLoadingStates() {
            // Simple cleanup - just clear all if called
            // In a more complex app, we'd track timestamps
            if (state.loadingStates.size > 5) {
                state.loadingStates.clear();
            }
        },

        // Clear results elements to prevent memory leaks
        clearResultsElements() {
            state.resultsElements = [];
        },

        // Reset load more pagination state
        resetLoadMoreState() {
            state.loadMoreState.shops = [];
            state.loadMoreState.currentlyShowing = 0;
        }
    };

    // ============================================================================
    // ERROR HANDLING
    // ============================================================================

    function handleError(error, context = '') {
        console.error(`Error in ${context}:`, error);

        // Log to external service in production
        if (window.location.hostname !== 'localhost') {
            // Could integrate with error tracking service here
            // Example: Sentry.captureException(error);
        }

        return {
            success: false,
            error: error.message || 'An unexpected error occurred'
        };
    }

    function showUserError(message) {
        // Display error to user
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        errorDiv.style.cssText = 'background: #fee; border: 1px solid #fcc; padding: 10px; margin: 10px 0; border-radius: 4px; color: #c33;';

        // Insert at top of container
        const container = document.querySelector('.container');
        if (container && container.firstChild) {
            container.insertBefore(errorDiv, container.firstChild);
        }

        // Auto-remove after 5 seconds
        setTimeout(() => errorDiv.remove(), 5000);
    }

    // ============================================================================
    // UTILITY FUNCTIONS
    // ============================================================================
    // Note: stateName, Price.fromKey/.average/.averageFromNumeric come from
    // window.CoffeeShopEnums (loaded by enums.js before this script).

    // ============================================================================
    // API RESPONSE VALIDATION
    // ============================================================================

    /**
     * Validates and extracts data from API response
     * @param {Object} result - The parsed JSON response
     * @returns {Object} - { valid: boolean, data: array, error: string|null }
     */
    function validateApiResponse(result) {
        // Check if result exists
        if (!result) {
            return { valid: false, data: [], error: 'Empty response from server' };
        }

        // Check for error response
        if (result.success === false) {
            const errorMsg = result.error?.message || 'Unknown server error';
            return { valid: false, data: [], error: errorMsg };
        }

        // Extract data array (handle both wrapped and unwrapped formats)
        const data = result.success ? result.data : result;

        // Validate that data is an array
        if (!Array.isArray(data)) {
            return { valid: false, data: [], error: 'Invalid data format: expected array' };
        }

        return { valid: true, data, error: null };
    }

    /**
     * Validates a shop object has required properties
     * @param {Object} shop - Shop object to validate
     * @returns {boolean}
     */
    function isValidShop(shop) {
        return shop &&
            typeof shop === 'object' &&
            shop.displayName &&
            typeof shop.displayName.text === 'string';
    }

    /**
     * Validates a state info object has required properties
     * @param {Object} stateInfo - State info object to validate
     * @returns {boolean}
     */
    function isValidStateInfo(stateInfo) {
        return stateInfo &&
            typeof stateInfo === 'object' &&
            typeof stateInfo.state_code === 'string' &&
            typeof stateInfo.shop_count === 'number';
    }

    // ============================================================================
    // API FUNCTIONS
    // ============================================================================

    /**
     * Delay helper for retry backoff
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise<void>}
     */
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Check if an error is retryable (network errors, timeouts, 5xx errors)
     * @param {Error} error - The error to check
     * @param {Response} response - Optional response object
     * @returns {boolean}
     */
    function isRetryableError(error, response = null) {
        // Network errors and timeouts are retryable
        if (error.name === 'AbortError' || error.message.includes('timeout')) {
            return true;
        }
        // Network failures (no response) are retryable
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            return true;
        }
        // 5xx server errors are retryable
        if (response && response.status >= 500) {
            return true;
        }
        // 429 Too Many Requests - retryable with backoff
        if (response && response.status === 429) {
            return true;
        }
        return false;
    }

    /**
     * Fetch with timeout and retry support using AbortController
     * Uses exponential backoff for retries
     * @param {string} url - The URL to fetch
     * @param {Object} options - Fetch options
     * @param {number} timeout - Timeout in milliseconds (defaults to FETCH_TIMEOUT_MS)
     * @param {number} retries - Number of retries remaining (defaults to MAX_RETRIES)
     * @returns {Promise<Response>} - The fetch response
     */
    async function fetchWithTimeout(url, options = {}, timeout = CONSTANTS.FETCH_TIMEOUT_MS, retries = CONSTANTS.MAX_RETRIES) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });

            // Check for server errors that should trigger retry
            if (!response.ok && isRetryableError(null, response) && retries > 0) {
                clearTimeout(timeoutId);
                const retryDelay = CONSTANTS.RETRY_DELAY_MS * Math.pow(2, CONSTANTS.MAX_RETRIES - retries);
                console.warn(`Request failed with ${response.status}, retrying in ${retryDelay}ms... (${retries} retries left)`);
                await delay(retryDelay);
                return fetchWithTimeout(url, options, timeout, retries - 1);
            }

            return response;
        } catch (error) {
            clearTimeout(timeoutId);

            // Check if error is retryable and we have retries left
            if (isRetryableError(error) && retries > 0) {
                const retryDelay = CONSTANTS.RETRY_DELAY_MS * Math.pow(2, CONSTANTS.MAX_RETRIES - retries);
                console.warn(`Request failed: ${error.message}, retrying in ${retryDelay}ms... (${retries} retries left)`);
                await delay(retryDelay);
                return fetchWithTimeout(url, options, timeout, retries - 1);
            }

            if (error.name === 'AbortError') {
                throw new Error(`Request timeout after ${timeout}ms (after ${CONSTANTS.MAX_RETRIES - retries} retries)`);
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async function checkServerStatus() {
        try {
            const response = await fetchWithTimeout(`${CONSTANTS.API_BASE_URL}/health`);
            if (response.ok) {
                const serverStatus = document.getElementById('serverStatus');
                if (serverStatus) {
                    serverStatus.style.display = 'none';
                }
                return true;
            } else {
                showServerError();
                return false;
            }
        } catch (error) {
            handleError(error, 'checkServerStatus');
            showServerError();
            return false;
        }
    }

    function showServerError() {
        const serverStatus = document.getElementById('serverStatus');
        if (serverStatus) {
            serverStatus.style.display = 'block';
        }
        if (state.dom.stateGrid) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error';
            errorDiv.textContent = 'Unable to connect to the server. Please try again later or contact support if the problem persists.';
            state.dom.stateGrid.replaceChildren();
            state.dom.stateGrid.appendChild(errorDiv);
        }
    }

    async function loadStateData(stateCode) {
        // Return cached data if available
        if (state.dataCache.has(stateCode)) {
            return state.dataCache.get(stateCode);
        }

        // Prevent duplicate requests for the same state
        if (state.loadingStates.has(stateCode)) {
            return []; // Request already in progress
        }

        // Mark this state as loading (with limit enforcement)
        stateUtils.addLoadingState(stateCode);

        try {
            const response = await fetchWithTimeout(`${CONSTANTS.API_BASE_URL}/states/${stateCode}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const result = await response.json();

            // Validate API response
            const validation = validateApiResponse(result);
            if (!validation.valid) {
                throw new Error(validation.error);
            }

            // Filter out invalid shop entries
            const stateShops = validation.data.filter(isValidShop);

            // Cache with size limit enforcement
            stateUtils.setCacheEntry(stateCode, stateShops);

            const stateInfo = state.availableStates.find(s => s.code === stateCode);
            if (stateInfo) {
                stateInfo.loaded = true;
            }

            updateStateCard(stateCode, stateShops);

            return stateShops;
        } catch (error) {
            handleError(error, `loadStateData(${stateCode})`);
            return [];
        } finally {
            // Always remove from loading set when done
            state.loadingStates.delete(stateCode);
        }
    }

    async function initializeStateList() {
        try {
            const response = await fetchWithTimeout(`${CONSTANTS.API_BASE_URL}/states`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const result = await response.json();

            // Validate API response
            const validation = validateApiResponse(result);
            if (!validation.valid) {
                throw new Error(validation.error);
            }

            // Filter and process valid state data from API
            state.availableStates = validation.data
                .filter(isValidStateInfo)
                .map(stateInfo => ({
                    code: stateInfo.state_code,
                    shopCount: stateInfo.shop_count,
                    avgPriceLevel: stateInfo.avg_price_level,
                    loaded: false
                }));

            // Add states to filter dropdown
            state.availableStates.forEach(stateInfo => {
                const option = document.createElement('option');
                option.value = stateInfo.code;
                option.textContent = stateName(stateInfo.code);
                state.dom.stateFilter.appendChild(option);
            });

            // Sort states for consistency
            state.availableStates.sort((a, b) => a.code.localeCompare(b.code));

            // Create initial state grid
            createStateGrid();
        } catch (error) {
            handleError(error, 'initializeStateList');
            if (state.dom.stateGrid) {
                const errorDiv = document.createElement('div');
                errorDiv.className = 'error';
                errorDiv.textContent = 'Error loading state data. Please make sure the server is running.';
                state.dom.stateGrid.replaceChildren();
                state.dom.stateGrid.appendChild(errorDiv);
            }
        }
    }

    // ============================================================================
    // DOM MANIPULATION
    // ============================================================================

    function createStateGrid() {
        if (!state.dom.stateGrid) return;

        state.dom.stateGrid.replaceChildren();

        const fragment = document.createDocumentFragment();

        state.availableStates.forEach(stateInfo => {
            const stateCard = document.createElement('div');
            stateCard.className = 'state-card';
            stateCard.id = `state-card-${stateInfo.code}`;
            stateCard.setAttribute('role', 'gridcell');

            const link = document.createElement('a');
            link.href = `/html/state.html?code=${stateInfo.code}`;
            link.setAttribute('aria-label', `${stateName(stateInfo.code)}: ${stateInfo.shopCount} coffee shops`);

            const h2 = document.createElement('h2');
            h2.textContent = stateName(stateInfo.code);

            const p1 = document.createElement('p');
            p1.textContent = `${stateInfo.shopCount} coffee shops`;

            const p2 = document.createElement('p');
            p2.textContent = `Avg. price: ${Price.averageFromNumeric(stateInfo.avgPriceLevel).label}`;

            link.appendChild(h2);
            link.appendChild(p1);
            link.appendChild(p2);
            stateCard.appendChild(link);

            // Preload data on hover
            stateCard.addEventListener('mouseenter', () => {
                if (!state.dataCache.has(stateInfo.code)) {
                    loadStateData(stateInfo.code).catch(err =>
                        handleError(err, `mouseenter-${stateInfo.code}`)
                    );
                }
            });

            fragment.appendChild(stateCard);

            // Load data during idle time with proper fallback
            scheduleIdleLoad(stateInfo.code);
        });

        state.dom.stateGrid.appendChild(fragment);
    }

    function scheduleIdleLoad(stateCode) {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
                loadStateData(stateCode).catch(err =>
                    handleError(err, `idleLoad-${stateCode}`)
                );
            }, { timeout: CONSTANTS.IDLE_CALLBACK_TIMEOUT_MS });
        } else {
            // Fallback with staggered loading to avoid overwhelming the server
            const delay = CONSTANTS.IDLE_CALLBACK_FALLBACK_MIN_MS +
                         Math.random() * (CONSTANTS.IDLE_CALLBACK_FALLBACK_MAX_MS - CONSTANTS.IDLE_CALLBACK_FALLBACK_MIN_MS);
            setTimeout(() => {
                loadStateData(stateCode).catch(err =>
                    handleError(err, `fallbackLoad-${stateCode}`)
                );
            }, delay);
        }
    }

    function updateStateCard(stateCode, shops) {
        const stateCard = document.getElementById(`state-card-${stateCode}`);
        if (!stateCard) return;

        const fullStateName = stateName(stateCode);
        const avgPrice = Price.average(shops.map(s => Price.fromKey(s.priceLevel))).label;

        const h2 = stateCard.querySelector('h2');
        const paragraphs = stateCard.querySelectorAll('p');

        if (h2) h2.textContent = fullStateName;
        if (paragraphs[0]) paragraphs[0].textContent = `${shops.length} coffee shops`;
        if (paragraphs[1]) paragraphs[1].textContent = `Avg. price: ${avgPrice}`;
    }

    function createShopElement(shop) {
        const item = document.createElement('li');
        item.className = 'coffee-item';

        const name = document.createElement('h3');
        name.textContent = shop.displayName?.text || 'Unknown';
        item.appendChild(name);

        if (shop.formattedAddress) {
            const address = document.createElement('p');
            address.textContent = shop.formattedAddress;
            item.appendChild(address);
        }

        const stateTag = document.createElement('p');
        stateTag.className = 'state-tag';
        stateTag.textContent = stateName(shop.state);
        item.appendChild(stateTag);

        if (shop.priceLevel) {
            const priceInfo = Price.fromKey(shop.priceLevel);
            const priceLabel = priceInfo.label.toLowerCase();
            const price = document.createElement('span');
            price.className = `price-level ${priceInfo.cssClass}`;
            price.textContent = priceLabel;
            // Add aria-label for screen readers since visual styling conveys meaning
            price.setAttribute('aria-label', `Price level: ${priceLabel}`);
            item.appendChild(price);
        }

        return item;
    }

    function displayResults(shops) {
        if (!state.dom.searchResultsContainer) return;

        state.dom.searchResultsContainer.replaceChildren();
        state.resultsElements = [];
        stateUtils.resetLoadMoreState();

        const header = document.createElement('h2');
        header.textContent = 'Search Results';
        state.dom.searchResultsContainer.appendChild(header);

        if (shops.length === 0) {
            const noResults = document.createElement('div');
            noResults.className = 'no-results';
            noResults.textContent = 'No coffee shops found';
            state.dom.searchResultsContainer.appendChild(noResults);
            return;
        }

        const resultCount = document.createElement('p');
        resultCount.className = 'result-count';
        resultCount.textContent = `${shops.length} found`;
        state.dom.searchResultsContainer.appendChild(resultCount);

        const fragment = document.createDocumentFragment();
        const shopsToRender = shops.length > CONSTANTS.SEARCH_RESULTS_PER_PAGE
            ? shops.slice(0, CONSTANTS.SEARCH_RESULTS_PER_PAGE)
            : shops;

        shopsToRender.forEach(shop => {
            const item = createShopElement(shop);
            state.resultsElements.push(item);
            fragment.appendChild(item);
        });

        state.dom.searchResultsContainer.appendChild(fragment);

        if (shops.length > CONSTANTS.SEARCH_RESULTS_PER_PAGE) {
            // Store pagination state for event delegation
            state.loadMoreState.shops = shops;
            state.loadMoreState.currentlyShowing = CONSTANTS.SEARCH_RESULTS_PER_PAGE;

            const loadMoreButton = document.createElement('button');
            loadMoreButton.className = 'load-more';
            loadMoreButton.textContent = `Load More (${shops.length - CONSTANTS.SEARCH_RESULTS_PER_PAGE} remaining)`;
            loadMoreButton.setAttribute('aria-label', `Load ${shops.length - CONSTANTS.SEARCH_RESULTS_PER_PAGE} more results`);
            // No individual click handler - uses event delegation
            state.dom.searchResultsContainer.appendChild(loadMoreButton);
        }

        // Move focus to results for screen reader users
        state.dom.searchResultsContainer.setAttribute('tabindex', '-1');
        state.dom.searchResultsContainer.focus();
    }

    function loadMoreResults() {
        const { shops, currentlyShowing } = state.loadMoreState;
        if (!shops.length || currentlyShowing >= shops.length) return;

        const nextBatch = Math.min(currentlyShowing + CONSTANTS.LOAD_MORE_BATCH_SIZE, shops.length);
        const additionalShops = shops.slice(currentlyShowing, nextBatch);

        const fragment = document.createDocumentFragment();

        additionalShops.forEach(shop => {
            const item = createShopElement(shop);
            state.resultsElements.push(item);
            fragment.appendChild(item);
        });

        const loadMoreButton = state.dom.searchResultsContainer.querySelector('.load-more');
        state.dom.searchResultsContainer.insertBefore(fragment, loadMoreButton);

        // Update state
        state.loadMoreState.currentlyShowing = nextBatch;

        if (nextBatch < shops.length) {
            loadMoreButton.textContent = `Load More (${shops.length - nextBatch} remaining)`;
            loadMoreButton.setAttribute('aria-label', `Load ${shops.length - nextBatch} more results`);
        } else {
            loadMoreButton.remove();
            stateUtils.resetLoadMoreState();
        }
    }

    /**
     * Create a skeleton loading card element
     * @returns {HTMLElement}
     */
    function createSkeletonCard() {
        const card = document.createElement('div');
        card.className = 'skeleton-card';
        card.setAttribute('aria-hidden', 'true');

        const title = document.createElement('div');
        title.className = 'skeleton skeleton-title';
        card.appendChild(title);

        const text = document.createElement('div');
        text.className = 'skeleton skeleton-text';
        card.appendChild(text);

        const textShort = document.createElement('div');
        textShort.className = 'skeleton skeleton-text-short';
        card.appendChild(textShort);

        return card;
    }

    // Note: createSkeletonItem is imported from window.CoffeeShopSkeleton (skeleton.js)

    function showLoadingState() {
        if (!state.dom.searchResultsContainer) return;

        state.dom.searchResultsContainer.style.display = 'block';
        state.dom.searchResultsContainer.replaceChildren();

        const h2 = document.createElement('h2');
        h2.textContent = 'Search Results';
        state.dom.searchResultsContainer.appendChild(h2);

        // Add accessible loading announcement
        const srText = document.createElement('p');
        srText.className = 'visually-hidden';
        srText.setAttribute('role', 'status');
        srText.setAttribute('aria-live', 'polite');
        srText.textContent = 'Loading search results...';
        state.dom.searchResultsContainer.appendChild(srText);

        // Show skeleton loading items
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < 5; i++) {
            fragment.appendChild(createSkeletonItem());
        }
        state.dom.searchResultsContainer.appendChild(fragment);

        if (state.dom.stateGrid) {
            state.dom.stateGrid.style.display = 'none';
        }
    }

    function hideLoadingState() {
        // Remove spinner loading
        const loading = state.dom.searchResultsContainer?.querySelector('.loading');
        if (loading) {
            loading.remove();
        }
        // Remove skeleton items
        const skeletons = state.dom.searchResultsContainer?.querySelectorAll('.skeleton-item');
        if (skeletons) {
            skeletons.forEach(s => s.remove());
        }
        // Remove loading announcement
        const srText = state.dom.searchResultsContainer?.querySelector('.visually-hidden[role="status"]');
        if (srText) {
            srText.remove();
        }
    }

    /**
     * Restores the state grid visibility after search error
     * Shows the state grid so users can still browse by state
     */
    function restoreStateGridVisibility() {
        if (state.dom.stateGrid) {
            state.dom.stateGrid.style.display = 'grid';
        }
    }

    // ============================================================================
    // SEARCH FUNCTIONALITY
    // ============================================================================

    function debounceSearch() {
        if (state.searchTimeout) {
            clearTimeout(state.searchTimeout);
        }
        state.searchTimeout = setTimeout(() => {
            searchCoffeeShops().catch(err =>
                handleError(err, 'debounceSearch')
            );
        }, CONSTANTS.SEARCH_DEBOUNCE_MS);
    }

    async function searchCoffeeShops() {
        const searchTerm = state.dom.searchInput?.value || '';
        const selectedState = state.dom.stateFilter?.value || '';
        const selectedPrice = state.dom.priceFilter?.value || '';

        // Update URL with search parameters
        updateURLParams({ q: searchTerm, state: selectedState, price: selectedPrice });

        if (!searchTerm && !selectedState && !selectedPrice) {
            if (state.dom.searchResultsContainer) {
                state.dom.searchResultsContainer.style.display = 'none';
            }
            if (state.dom.stateGrid) {
                state.dom.stateGrid.style.display = 'grid';
            }
            return;
        }

        showLoadingState();

        try {
            const params = new URLSearchParams();
            if (searchTerm) params.append('q', searchTerm);
            if (selectedState) params.append('state', selectedState);
            if (selectedPrice) params.append('price', selectedPrice);

            const response = await fetchWithTimeout(`${CONSTANTS.API_BASE_URL}/search?${params.toString()}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            // Validate API response
            const validation = validateApiResponse(result);
            if (!validation.valid) {
                throw new Error(validation.error);
            }

            // Filter out invalid shop entries
            const filteredShops = validation.data.filter(isValidShop);

            hideLoadingState();
            state.lastSearchResults = filteredShops;
            displayResults(filteredShops);
        } catch (error) {
            hideLoadingState();
            handleError(error, 'searchCoffeeShops');

            // Hide search results and restore state grid so users can still browse
            if (state.dom.searchResultsContainer) {
                state.dom.searchResultsContainer.style.display = 'none';
            }
            restoreStateGridVisibility();

            showUserError('Failed to search coffee shops. Please try again.');
        }
    }

    async function findNearbyShops() {
        if (!navigator.geolocation) {
            showUserError('Geolocation is not supported by your browser.');
            return;
        }

        showLoadingState();

        navigator.geolocation.getCurrentPosition(async (position) => {
            const { latitude, longitude } = position.coords;
            try {
                const shops = await fetchNearbyShops(latitude, longitude);
                shops.sort((a, b) => a.distance - b.distance);
                hideLoadingState();
                displayResults(shops);
            } catch (error) {
                hideLoadingState();
                handleError(error, 'findNearbyShops');
                showUserError('Could not fetch nearby coffee shops.');
            }
        }, (error) => {
            hideLoadingState();
            handleError(error, 'findNearbyShops');
            showUserError('Unable to retrieve your location. Please ensure you have enabled location services.');
        });
    }

    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Radius of the earth in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const d = R * c; // Distance in km
        return d;
    }

    async function fetchNearbyShops(latitude, longitude) {
        // Simulate fetching all shops and calculating distance.
        // In a real application, this would be a dedicated API endpoint.
        const allShops = [
            { displayName: { text: 'The Coffee House' }, formattedAddress: '123 Main St, San Francisco, CA', state: 'CA', priceLevel: 'PRICE_LEVEL_MODERATE', lat: 37.7749, lon: -122.4194 },
            { displayName: { text: 'Java Junction' }, formattedAddress: '456 Market St, San Francisco, CA', state: 'CA', priceLevel: 'PRICE_LEVEL_INEXPENSIVE', lat: 37.795, lon: -122.404 },
            { displayName: { text: 'Daily Grind' }, formattedAddress: '789 Mission St, San Francisco, CA', state: 'CA', priceLevel: 'PRICE_LEVEL_EXPENSIVE', lat: 37.783, lon: -122.408 },
            { displayName: { text: 'Alabama Coffee' }, formattedAddress: '101 Alabama St, Mobile, AL', state: 'AL', priceLevel: 'PRICE_LEVEL_MODERATE', lat: 30.6954, lon: -88.0399 },
            { displayName: { text: 'Arizona Brew' }, formattedAddress: '202 Arizona Ave, Phoenix, AZ', state: 'AZ', priceLevel: 'PRICE_LEVEL_INEXPENSIVE', lat: 33.4484, lon: -112.0740 }
        ];

        return allShops.map(shop => {
            const distance = calculateDistance(latitude, longitude, shop.lat, shop.lon);
            return { ...shop, distance };
        });
    }

    // ============================================================================
    // URL STATE MANAGEMENT
    // ============================================================================

    function updateURLParams(params) {
        const url = new URL(window.location.href);

        // Clear existing search params
        url.search = '';

        // Add non-empty params
        Object.keys(params).forEach(key => {
            if (params[key]) {
                url.searchParams.set(key, params[key]);
            }
        });

        // Update URL without page reload
        window.history.replaceState({}, '', url);
    }

    function loadURLParams() {
        const params = new URLSearchParams(window.location.search);

        const searchTerm = params.get('q') || '';
        const stateParam = params.get('state') || '';
        const priceParam = params.get('price') || '';

        // Set form values from URL
        if (state.dom.searchInput) state.dom.searchInput.value = searchTerm;
        if (state.dom.stateFilter) state.dom.stateFilter.value = stateParam;
        if (state.dom.priceFilter) state.dom.priceFilter.value = priceParam;

        // Trigger search if any params exist
        if (searchTerm || stateParam || priceParam) {
            searchCoffeeShops().catch(err =>
                handleError(err, 'loadURLParams')
            );
        }
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================

    /**
     * Cache DOM elements and validate required elements exist
     * @returns {boolean} True if all required elements found
     */
    function cacheDOMElements() {
        state.dom.searchResultsContainer = document.getElementById('searchResults');
        state.dom.stateGrid = document.getElementById('stateGrid');
        state.dom.searchInput = document.getElementById('searchInput');
        state.dom.stateFilter = document.getElementById('stateFilter');
        state.dom.priceFilter = document.getElementById('priceFilter');
        state.dom.findNearMe = document.getElementById('findNearMe');

        // Validate required elements exist
        const requiredElements = ['stateGrid'];
        const missingElements = requiredElements.filter(id => !state.dom[id]);
        if (state.dom.findNearMe) {
            state.dom.findNearMe.addEventListener('click', findNearbyShops);
        }

        if (missingElements.length > 0) {
            console.error('Missing required DOM elements:', missingElements);
            return false;
        }

        return true;
    }

    /**
     * Show fallback content when app fails to initialize
     */
    function showFallbackContent() {
        const container = document.querySelector('.container');
        if (container) {
            const fallback = document.createElement('div');
            fallback.className = 'fallback-content';
            fallback.setAttribute('role', 'alert');
            fallback.innerHTML = `
                <h2>Unable to Load Application</h2>
                <p>We're having trouble loading the coffee shop directory.</p>
                <p>Please try:</p>
                <ul>
                    <li>Refreshing the page</li>
                    <li>Checking your internet connection</li>
                    <li>Trying again in a few minutes</li>
                </ul>
            `;
            container.appendChild(fallback);
        }
    }

    function attachEventListeners() {
        if (state.dom.searchInput) {
            state.dom.searchInput.addEventListener('input', debounceSearch);
        }
        if (state.dom.stateFilter) {
            state.dom.stateFilter.addEventListener('change', debounceSearch);
        }
        if (state.dom.priceFilter) {
            state.dom.priceFilter.addEventListener('change', debounceSearch);
        }

        // Event delegation for Load More button - single handler instead of reassigning onclick
        if (state.dom.searchResultsContainer) {
            state.dom.searchResultsContainer.addEventListener('click', (event) => {
                if (event.target.classList.contains('load-more')) {
                    loadMoreResults();
                }
            });
        }

        // Keyboard navigation for state grid
        if (state.dom.stateGrid) {
            state.dom.stateGrid.addEventListener('keydown', handleGridKeyNavigation);
            // Cache grid columns and update on resize
            updateGridColumns();
            window.addEventListener('resize', handleResize);
        }
    }

    /**
     * Calculate and cache the number of grid columns
     * Used for keyboard navigation performance
     */
    function updateGridColumns() {
        if (!state.dom.stateGrid) return;
        const gridStyle = getComputedStyle(state.dom.stateGrid);
        state.gridColumns = gridStyle.gridTemplateColumns.split(' ').length || 4;
    }

    /**
     * Debounced resize handler to update cached grid columns
     */
    function handleResize() {
        if (state.resizeTimeout) {
            clearTimeout(state.resizeTimeout);
        }
        state.resizeTimeout = setTimeout(updateGridColumns, 150);
    }

    /**
     * Handle keyboard navigation in the state grid
     * Supports arrow keys to move focus between state cards
     * @param {KeyboardEvent} event
     */
    function handleGridKeyNavigation(event) {
        const key = event.key;
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) {
            return;
        }

        const cards = Array.from(state.dom.stateGrid.querySelectorAll('.state-card a'));
        if (cards.length === 0) return;

        const currentIndex = cards.indexOf(document.activeElement);
        if (currentIndex === -1) return;

        // Use cached grid columns (calculated once and updated on resize)
        const columns = state.gridColumns || 4;

        let newIndex = currentIndex;

        switch (key) {
            case 'ArrowRight':
                newIndex = Math.min(currentIndex + 1, cards.length - 1);
                break;
            case 'ArrowLeft':
                newIndex = Math.max(currentIndex - 1, 0);
                break;
            case 'ArrowDown':
                newIndex = Math.min(currentIndex + columns, cards.length - 1);
                break;
            case 'ArrowUp':
                newIndex = Math.max(currentIndex - columns, 0);
                break;
            case 'Home':
                newIndex = 0;
                break;
            case 'End':
                newIndex = cards.length - 1;
                break;
        }

        if (newIndex !== currentIndex) {
            event.preventDefault();
            cards[newIndex].focus();
        }
    }

    async function initialize() {
        // Create a timeout promise for initialization
        const initTimeout = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Initialization timeout after ${CONSTANTS.INIT_TIMEOUT_MS}ms`));
            }, CONSTANTS.INIT_TIMEOUT_MS);
        });

        // Create the actual initialization promise
        const initProcess = async () => {
            // Validate DOM elements exist before proceeding
            const domValid = cacheDOMElements();
            if (!domValid) {
                showFallbackContent();
                return;
            }

            attachEventListeners();

            const serverIsRunning = await checkServerStatus();
            if (serverIsRunning) {
                await initializeStateList();
                loadURLParams();
            }
        };

        try {
            // Race between initialization and timeout
            await Promise.race([initProcess(), initTimeout]);
        } catch (error) {
            handleError(error, 'initialize');
            showUserError('Failed to initialize application. Please refresh the page.');
            showFallbackContent();
        }
    }

    // ============================================================================
    // DOM READY
    // ============================================================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        // DOM is already loaded
        initialize();
    }

})();
