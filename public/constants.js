/**
 * Shared Constants and Utilities
 * Used by both app.js and state.html to avoid code duplication
 */

// Make available globally for browser usage
(function(global) {
    'use strict';

    // ============================================================================
    // CONSTANTS
    // ============================================================================

    const PRICE_LEVELS = {
        'PRICE_LEVEL_INEXPENSIVE': 1,
        'PRICE_LEVEL_MODERATE': 2,
        'PRICE_LEVEL_EXPENSIVE': 3
    };

    const STATE_NAMES = {
        'AK': 'Alaska', 'AL': 'Alabama', 'AR': 'Arkansas', 'AZ': 'Arizona',
        'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DC': 'Washington D.C.',
        'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii',
        'IA': 'Iowa', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana',
        'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'MA': 'Massachusetts',
        'MD': 'Maryland', 'ME': 'Maine', 'MI': 'Michigan', 'MN': 'Minnesota',
        'MO': 'Missouri', 'MS': 'Mississippi', 'MT': 'Montana', 'NC': 'North Carolina',
        'ND': 'North Dakota', 'NE': 'Nebraska', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
        'NM': 'New Mexico', 'NV': 'Nevada', 'NY': 'New York', 'OH': 'Ohio',
        'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'PR': 'Puerto Rico',
        'RI': 'Rhode Island', 'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee',
        'TX': 'Texas', 'UT': 'Utah', 'VA': 'Virginia', 'VT': 'Vermont',
        'WA': 'Washington', 'WI': 'Wisconsin', 'WV': 'West Virginia', 'WY': 'Wyoming'
    };

    // ============================================================================
    // UTILITY FUNCTIONS
    // ============================================================================

    /**
     * Get CSS class for a price level
     * @param {string} priceLevel - The price level constant
     * @returns {string} CSS class name
     */
    function getPriceLevelClass(priceLevel) {
        if (!priceLevel) return '';
        switch (priceLevel) {
            case 'PRICE_LEVEL_INEXPENSIVE': return 'inexpensive';
            case 'PRICE_LEVEL_MODERATE': return 'moderate';
            case 'PRICE_LEVEL_EXPENSIVE': return 'expensive';
            default: return '';
        }
    }

    /**
     * Format price level for display
     * @param {string} priceLevel - The price level constant
     * @returns {string} Formatted display text
     */
    function formatPriceLevel(priceLevel) {
        if (!priceLevel) return '';
        return priceLevel.replace('PRICE_LEVEL_', '').toLowerCase();
    }

    /**
     * Calculate average price from shop array
     * @param {Array} shops - Array of shop objects with priceLevel property
     * @returns {string} Average price description
     */
    function calculateAveragePrice(shops) {
        let total = 0;
        let count = 0;

        shops.forEach(shop => {
            if (shop.priceLevel && PRICE_LEVELS[shop.priceLevel]) {
                total += PRICE_LEVELS[shop.priceLevel];
                count++;
            }
        });

        if (count === 0) return 'N/A';

        const avg = total / count;
        if (avg < 1.5) return 'Inexpensive';
        if (avg < 2.5) return 'Moderate';
        return 'Expensive';
    }

    /**
     * Calculate average price from numeric level
     * @param {number} avgLevel - Numeric average (1-3)
     * @returns {string} Average price description
     */
    function calculateAveragePriceFromLevel(avgLevel) {
        if (!avgLevel) return 'N/A';
        if (avgLevel < 1.5) return 'Inexpensive';
        if (avgLevel < 2.5) return 'Moderate';
        return 'Expensive';
    }

    /**
     * Get full state name from code
     * @param {string} stateCode - Two-letter state code
     * @returns {string} Full state name or the code if not found
     */
    function getStateName(stateCode) {
        return STATE_NAMES[stateCode] || stateCode;
    }

    /**
     * Validate a state code
     * @param {string} code - State code to validate
     * @returns {boolean} True if valid
     */
    function isValidStateCode(code) {
        return code && /^[A-Z]{2}$/.test(code) && STATE_NAMES.hasOwnProperty(code);
    }

    // ============================================================================
    // DOM UTILITIES
    // ============================================================================

    /**
     * Create a skeleton loading item for visual loading feedback
     * Shared between app.js and state.js to avoid code duplication
     * @returns {HTMLLIElement} A skeleton list item element
     */
    function createSkeletonItem() {
        var item = document.createElement('li');
        item.className = 'skeleton-item';
        item.setAttribute('aria-hidden', 'true');

        var name = document.createElement('div');
        name.className = 'skeleton skeleton-name';
        item.appendChild(name);

        var address = document.createElement('div');
        address.className = 'skeleton skeleton-address';
        item.appendChild(address);

        var price = document.createElement('div');
        price.className = 'skeleton skeleton-price';
        item.appendChild(price);

        return item;
    }

    // ============================================================================
    // EXPORTS
    // ============================================================================

    const CoffeeShopConstants = {
        PRICE_LEVELS,
        STATE_NAMES,
        getPriceLevelClass,
        formatPriceLevel,
        calculateAveragePrice,
        calculateAveragePriceFromLevel,
        getStateName,
        isValidStateCode,
        createSkeletonItem
    };

    // Export for browser
    global.CoffeeShopConstants = CoffeeShopConstants;

    // Export for Node.js (if needed)
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = CoffeeShopConstants;
    }

})(typeof window !== 'undefined' ? window : global);

// Service Worker Registration
// Provides offline support and caching
(function() {
    'use strict';

    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        window.addEventListener('load', function() {
            navigator.serviceWorker.register('/sw.js')
                .then(function(registration) {
                    console.log('ServiceWorker registered with scope:', registration.scope);

                    // Check for updates periodically
                    setInterval(function() {
                        registration.update();
                    }, 60 * 60 * 1000); // Check every hour

                    // Handle updates
                    registration.addEventListener('updatefound', function() {
                        const newWorker = registration.installing;
                        if (newWorker) {
                            newWorker.addEventListener('statechange', function() {
                                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                    // New version available
                                    console.log('New version available! Refresh to update.');
                                }
                            });
                        }
                    });
                })
                .catch(function(error) {
                    console.warn('ServiceWorker registration failed:', error);
                });
        });
    }
})();

// Connection State Detection
// Shows offline/online status banner
(function() {
    'use strict';

    if (typeof window === 'undefined') return;

    var connectionBanner = null;
    var hideTimeout = null;

    // Create the connection status banner
    function createBanner() {
        if (connectionBanner) return connectionBanner;

        connectionBanner = document.createElement('div');
        connectionBanner.className = 'connection-status';
        connectionBanner.setAttribute('role', 'alert');
        connectionBanner.setAttribute('aria-live', 'assertive');
        document.body.insertBefore(connectionBanner, document.body.firstChild);

        return connectionBanner;
    }

    // Show offline status
    function showOffline() {
        var banner = createBanner();
        banner.textContent = 'You are offline. Some features may not be available.';
        banner.className = 'connection-status offline';
        document.body.classList.add('has-offline-banner');

        if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
        }
    }

    // Show online status (briefly)
    function showOnline() {
        var banner = createBanner();
        banner.textContent = 'You are back online!';
        banner.className = 'connection-status online';
        document.body.classList.add('has-offline-banner');

        // Hide after 3 seconds
        if (hideTimeout) {
            clearTimeout(hideTimeout);
        }
        hideTimeout = setTimeout(function() {
            banner.className = 'connection-status';
            document.body.classList.remove('has-offline-banner');
        }, 3000);
    }

    // Hide banner
    function hideBanner() {
        if (connectionBanner) {
            connectionBanner.className = 'connection-status';
            document.body.classList.remove('has-offline-banner');
        }
    }

    // Listen for online/offline events
    window.addEventListener('online', function() {
        console.log('Connection restored');
        showOnline();
    });

    window.addEventListener('offline', function() {
        console.log('Connection lost');
        showOffline();
    });

    // Check initial state
    window.addEventListener('load', function() {
        if (!navigator.onLine) {
            showOffline();
        }
    });

    // Expose functions for external use
    if (typeof window.CoffeeShopConstants !== 'undefined') {
        window.CoffeeShopConstants.connection = {
            showOffline: showOffline,
            showOnline: showOnline,
            hideBanner: hideBanner,
            isOnline: function() { return navigator.onLine; }
        };
    }
})();
