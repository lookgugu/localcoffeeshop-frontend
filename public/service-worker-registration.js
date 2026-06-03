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
