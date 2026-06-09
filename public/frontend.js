// Coffee Shop Directory Application
// Wrapped in IIFE to avoid global namespace pollution
(function() {
    'use strict';

    // ============================================================================
    // CONSTANTS (uses shared enums from enums.js)
    // ============================================================================

    // Hard dep on enums + skeleton + api-client + store — fail loud
    // if any are missing instead of silently falling back. Script-load order
    // is enforced by the asset loader (async=false on dynamically-injected tags).
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
    const Enums = window.CoffeeShopEnums;
    const { stateName, isStateCode, Price } = Enums;
    const { createSkeletonItem } = window.CoffeeShopSkeleton;
    const api = window.ApiClient;
    const { ApiEnvelopeError, ApiHttpError } = api.errors;
    const { createStore } = window.CoffeeShopStore;

    const CONSTANTS = {
        // Performance Settings
        SEARCH_DEBOUNCE_MS: 300,

        // Pagination
        SEARCH_RESULTS_PER_PAGE: 50,
        LOAD_MORE_BATCH_SIZE: 50,

        // Network Settings
        INIT_TIMEOUT_MS: 30000   // 30 second timeout for full initialization
    };

    // ============================================================================
    // STATE — explicit pub/sub Store (ADR-0001)
    // ============================================================================

    // The store owns what the rest of the app reacts to. Renderers
    // subscribe per-key; mutations go through store.update / store.set.
    //   - availableStates: index of state codes/counts shown on the grid
    //   - lastSearchResults: most recent search result list (for re-renders)
    //   - loadMoreState: pagination cursor for the search-results list
    const store = createStore({
        availableStates: [],
        lastSearchResults: null,
        loadMoreState: { shops: [], currentlyShowing: 0 }
    });

    // Rendering concerns — local to the view layer, NOT in the store.
    // The original `state` object conflated these with real app state;
    // they are debounce timers, layout memos, and DOM-ref caches that no
    // subscriber ever needs to react to.
    let searchTimeout = null;   // debounce timer for the search input
    let resizeTimeout = null;   // debounce timer for window resize
    let gridColumns = null;     // cached column count for keyboard nav
    const resultsElements = []; // DOM nodes accumulated during render
    const dom = {               // cached element references
        searchResultsContainer: null,
        stateGrid: null,
        searchInput: null,
        stateFilter: null,
        priceFilter: null,
        findNearMe: null
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
    // Note: envelope unwrap + retry + timeout live in ApiClient (api-client.js).
    // These local helpers only validate the *shape* of the unwrapped data.

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

    async function checkServerStatus() {
        try {
            await api.get('/health');
            const serverStatus = document.getElementById('serverStatus');
            if (serverStatus) {
                serverStatus.style.display = 'none';
            }
            return true;
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
        if (dom.stateGrid) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error';
            errorDiv.textContent = 'Unable to connect to the server. Please try again later or contact support if the problem persists.';
            dom.stateGrid.replaceChildren();
            dom.stateGrid.appendChild(errorDiv);
        }
    }

    async function initializeStateList() {
        try {
            const data = await api.get('/states');

            if (!Array.isArray(data)) {
                throw new Error('Invalid data format: expected array');
            }

            // Build a sorted-by-code list of state metadata. Sort eagerly so we
            // write the final shape to the store exactly once.
            const availableStates = data
                .filter(isValidStateInfo)
                .map(stateInfo => ({
                    code: stateInfo.state_code,
                    shopCount: stateInfo.shop_count,
                    avgPriceLevel: stateInfo.avg_price_level,
                    loaded: false
                }))
                .sort((a, b) => a.code.localeCompare(b.code));

            store.set('availableStates', availableStates);

            // Add states to filter dropdown
            availableStates.forEach(stateInfo => {
                const option = document.createElement('option');
                option.value = stateInfo.code;
                option.textContent = stateName(stateInfo.code);
                dom.stateFilter.appendChild(option);
            });
        } catch (error) {
            handleError(error, 'initializeStateList');
            if (dom.stateGrid) {
                const errorDiv = document.createElement('div');
                errorDiv.className = 'error';
                errorDiv.textContent = 'Error loading state data. Please make sure the server is running.';
                dom.stateGrid.replaceChildren();
                dom.stateGrid.appendChild(errorDiv);
            }
        }
    }

    // ============================================================================
    // DOM MANIPULATION
    // ============================================================================

    function createStateGrid() {
        if (!dom.stateGrid) return;

        dom.stateGrid.replaceChildren();

        const fragment = document.createDocumentFragment();

        store.get('availableStates').forEach(stateInfo => {
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

            // Do not eagerly load every state's detail page from the homepage.
            // The /states response already contains the counts/average price
            // needed for these cards. Fetching /states/:code for every card on
            // first paint creates a client-side thundering herd (50+ API calls,
            // ~1MB JSON) and makes the site feel slow. Detail data is fetched
            // only when the visitor opens a state page.
            fragment.appendChild(stateCard);
        });

        dom.stateGrid.appendChild(fragment);
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
        if (!dom.searchResultsContainer) return;

        dom.searchResultsContainer.replaceChildren();
        resultsElements.length = 0;
        store.set('loadMoreState', { shops: [], currentlyShowing: 0 });

        const header = document.createElement('h2');
        header.textContent = 'Search Results';
        dom.searchResultsContainer.appendChild(header);

        if (shops.length === 0) {
            const noResults = document.createElement('div');
            noResults.className = 'no-results';
            noResults.textContent = 'No coffee shops found';
            dom.searchResultsContainer.appendChild(noResults);
            return;
        }

        const resultCount = document.createElement('p');
        resultCount.className = 'result-count';
        resultCount.textContent = `${shops.length} found`;
        dom.searchResultsContainer.appendChild(resultCount);

        const fragment = document.createDocumentFragment();
        const shopsToRender = shops.length > CONSTANTS.SEARCH_RESULTS_PER_PAGE
            ? shops.slice(0, CONSTANTS.SEARCH_RESULTS_PER_PAGE)
            : shops;

        shopsToRender.forEach(shop => {
            const item = createShopElement(shop);
            resultsElements.push(item);
            fragment.appendChild(item);
        });

        dom.searchResultsContainer.appendChild(fragment);

        if (shops.length > CONSTANTS.SEARCH_RESULTS_PER_PAGE) {
            // Persist pagination cursor for the Load More handler.
            store.set('loadMoreState', {
                shops,
                currentlyShowing: CONSTANTS.SEARCH_RESULTS_PER_PAGE
            });

            const loadMoreButton = document.createElement('button');
            loadMoreButton.className = 'load-more';
            loadMoreButton.textContent = `Load More (${shops.length - CONSTANTS.SEARCH_RESULTS_PER_PAGE} remaining)`;
            loadMoreButton.setAttribute('aria-label', `Load ${shops.length - CONSTANTS.SEARCH_RESULTS_PER_PAGE} more results`);
            // No individual click handler - uses event delegation
            dom.searchResultsContainer.appendChild(loadMoreButton);
        }

        // Move focus to results for screen reader users
        dom.searchResultsContainer.setAttribute('tabindex', '-1');
        dom.searchResultsContainer.focus();
    }

    function loadMoreResults() {
        const { shops, currentlyShowing } = store.get('loadMoreState');
        if (!shops.length || currentlyShowing >= shops.length) return;

        const nextBatch = Math.min(currentlyShowing + CONSTANTS.LOAD_MORE_BATCH_SIZE, shops.length);
        const additionalShops = shops.slice(currentlyShowing, nextBatch);

        const fragment = document.createDocumentFragment();

        additionalShops.forEach(shop => {
            const item = createShopElement(shop);
            resultsElements.push(item);
            fragment.appendChild(item);
        });

        const loadMoreButton = dom.searchResultsContainer.querySelector('.load-more');
        dom.searchResultsContainer.insertBefore(fragment, loadMoreButton);

        // Advance the pagination cursor (new object reference → subscribers notified).
        store.update('loadMoreState', prev => ({ ...prev, currentlyShowing: nextBatch }));

        if (nextBatch < shops.length) {
            loadMoreButton.textContent = `Load More (${shops.length - nextBatch} remaining)`;
            loadMoreButton.setAttribute('aria-label', `Load ${shops.length - nextBatch} more results`);
        } else {
            loadMoreButton.remove();
            store.set('loadMoreState', { shops: [], currentlyShowing: 0 });
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
        if (!dom.searchResultsContainer) return;

        dom.searchResultsContainer.style.display = 'block';
        dom.searchResultsContainer.replaceChildren();

        const h2 = document.createElement('h2');
        h2.textContent = 'Search Results';
        dom.searchResultsContainer.appendChild(h2);

        // Add accessible loading announcement
        const srText = document.createElement('p');
        srText.className = 'visually-hidden';
        srText.setAttribute('role', 'status');
        srText.setAttribute('aria-live', 'polite');
        srText.textContent = 'Loading search results...';
        dom.searchResultsContainer.appendChild(srText);

        // Show skeleton loading items
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < 5; i++) {
            fragment.appendChild(createSkeletonItem());
        }
        dom.searchResultsContainer.appendChild(fragment);

        if (dom.stateGrid) {
            dom.stateGrid.style.display = 'none';
        }
    }

    function hideLoadingState() {
        // Remove spinner loading
        const loading = dom.searchResultsContainer?.querySelector('.loading');
        if (loading) {
            loading.remove();
        }
        // Remove skeleton items
        const skeletons = dom.searchResultsContainer?.querySelectorAll('.skeleton-item');
        if (skeletons) {
            skeletons.forEach(s => s.remove());
        }
        // Remove loading announcement
        const srText = dom.searchResultsContainer?.querySelector('.visually-hidden[role="status"]');
        if (srText) {
            srText.remove();
        }
    }

    /**
     * Restores the state grid visibility after search error
     * Shows the state grid so users can still browse by state
     */
    function restoreStateGridVisibility() {
        if (dom.stateGrid) {
            dom.stateGrid.style.display = 'grid';
        }
    }

    // ============================================================================
    // SEARCH FUNCTIONALITY
    // ============================================================================

    function debounceSearch() {
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }
        searchTimeout = setTimeout(() => {
            searchCoffeeShops().catch(err =>
                handleError(err, 'debounceSearch')
            );
        }, CONSTANTS.SEARCH_DEBOUNCE_MS);
    }

    async function searchCoffeeShops() {
        const searchTerm = dom.searchInput?.value || '';
        const selectedState = dom.stateFilter?.value || '';
        const selectedPrice = dom.priceFilter?.value || '';

        // Update URL with search parameters
        updateURLParams({ q: searchTerm, state: selectedState, price: selectedPrice });

        if (!searchTerm && !selectedState && !selectedPrice) {
            if (dom.searchResultsContainer) {
                dom.searchResultsContainer.style.display = 'none';
            }
            if (dom.stateGrid) {
                dom.stateGrid.style.display = 'grid';
            }
            return;
        }

        showLoadingState();

        try {
            const data = await api.get('/search', {
                query: {
                    q: searchTerm,
                    state: selectedState,
                    price: selectedPrice,
                },
            });

            if (!Array.isArray(data)) {
                throw new Error('Invalid data format: expected array');
            }

            // Filter out invalid shop entries
            const filteredShops = data.filter(isValidShop);

            hideLoadingState();
            // The 'lastSearchResults' subscriber (createStore wiring in initialize)
            // calls displayResults — no explicit call needed here.
            store.set('lastSearchResults', filteredShops);
        } catch (error) {
            hideLoadingState();
            handleError(error, 'searchCoffeeShops');

            // Hide search results and restore state grid so users can still browse
            if (dom.searchResultsContainer) {
                dom.searchResultsContainer.style.display = 'none';
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
                // Subscriber on 'lastSearchResults' calls displayResults.
                store.set('lastSearchResults', shops);
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
        if (dom.searchInput) dom.searchInput.value = searchTerm;
        if (dom.stateFilter) dom.stateFilter.value = stateParam;
        if (dom.priceFilter) dom.priceFilter.value = priceParam;

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
        dom.searchResultsContainer = document.getElementById('searchResults');
        dom.stateGrid = document.getElementById('stateGrid');
        dom.searchInput = document.getElementById('searchInput');
        dom.stateFilter = document.getElementById('stateFilter');
        dom.priceFilter = document.getElementById('priceFilter');
        dom.findNearMe = document.getElementById('findNearMe');

        // Validate required elements exist
        const requiredElements = ['stateGrid'];
        const missingElements = requiredElements.filter(id => !dom[id]);
        if (dom.findNearMe) {
            dom.findNearMe.addEventListener('click', findNearbyShops);
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
        if (dom.searchInput) {
            dom.searchInput.addEventListener('input', debounceSearch);
        }
        if (dom.stateFilter) {
            dom.stateFilter.addEventListener('change', debounceSearch);
        }
        if (dom.priceFilter) {
            dom.priceFilter.addEventListener('change', debounceSearch);
        }

        // Event delegation for Load More button - single handler instead of reassigning onclick
        if (dom.searchResultsContainer) {
            dom.searchResultsContainer.addEventListener('click', (event) => {
                if (event.target.classList.contains('load-more')) {
                    loadMoreResults();
                }
            });
        }

        // Keyboard navigation for state grid
        if (dom.stateGrid) {
            dom.stateGrid.addEventListener('keydown', handleGridKeyNavigation);
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
        if (!dom.stateGrid) return;
        const gridStyle = getComputedStyle(dom.stateGrid);
        gridColumns = gridStyle.gridTemplateColumns.split(' ').length || 4;
    }

    /**
     * Debounced resize handler to update cached grid columns
     */
    function handleResize() {
        if (resizeTimeout) {
            clearTimeout(resizeTimeout);
        }
        resizeTimeout = setTimeout(updateGridColumns, 150);
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

        const cards = Array.from(dom.stateGrid.querySelectorAll('.state-card a'));
        if (cards.length === 0) return;

        const currentIndex = cards.indexOf(document.activeElement);
        if (currentIndex === -1) return;

        // Use cached grid columns (calculated once and updated on resize)
        const columns = gridColumns || 4;

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

            // Per-key subscribers: renderers react to store writes.
            //   - availableStates → createStateGrid: re-renders the state grid
            //     whenever the index list of available states is replaced.
            //   - lastSearchResults → displayResults: re-renders the search
            //     results list whenever a new search finishes.
            // Per ADR-0001, there is no subscribeAll — each renderer subscribes
            // to ONLY the key it actually reads.
            store.subscribe('availableStates', createStateGrid);
            store.subscribe('lastSearchResults', displayResults);

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
