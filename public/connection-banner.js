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

    // Expose for any view that needs to drive the banner programmatically.
    window.CoffeeShopConnection = {
        showOffline: showOffline,
        showOnline: showOnline,
        hideBanner: hideBanner,
        isOnline: function() { return navigator.onLine; }
    };
})();
