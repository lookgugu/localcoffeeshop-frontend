(function() {
    // Check if running in a production-like environment.
    const isProduction = window.location.hostname === 'localcoffeeshop.co';

    // Define asset paths
    const assets = {
        css: isProduction ? '/dist/styles.min.css' : '/styles.css',
        enums: isProduction ? '/dist/enums.min.js' : '/enums.js',
        skeleton: isProduction ? '/dist/skeleton.min.js' : '/skeleton.js',
        apiClient: isProduction ? '/dist/api-client.min.js' : '/api-client.js',
        store: isProduction ? '/dist/store.min.js' : '/store.js',
        swRegistration: isProduction ? '/dist/service-worker-registration.min.js' : '/service-worker-registration.js',
        connectionBanner: isProduction ? '/dist/connection-banner.min.js' : '/connection-banner.js',
        state: isProduction ? '/dist/state.min.js' : '/html/state.js'
    };

    // Load CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = assets.css;
    document.head.appendChild(link);

    // Load critical scripts (side-effect; order vs app code doesn't matter)
    const consentScript = document.createElement('script');
    consentScript.src = '/consent-banner.js';
    document.head.appendChild(consentScript);

    const analyticsScript = document.createElement('script');
    analyticsScript.src = '/analytics.js';
    analyticsScript.async = true;
    document.head.appendChild(analyticsScript);

    const swScript = document.createElement('script');
    swScript.src = assets.swRegistration;
    document.head.appendChild(swScript);

    const bannerScript = document.createElement('script');
    bannerScript.src = assets.connectionBanner;
    document.head.appendChild(bannerScript);

    // App-code deps: enums + skeleton + api-client + store MUST load and
    // execute before state.js (state.js throws if any global is missing).
    // The state-detail page doesn't need lru-map (no LruMap usage), so we
    // skip it here to keep page weight down. Dynamically-inserted scripts
    // default to async:true (no ordering guarantee), so we force async=false
    // to preserve insertion order.
    const enumsScript = document.createElement('script');
    enumsScript.src = assets.enums;
    enumsScript.async = false;
    document.head.appendChild(enumsScript);

    const skeletonScript = document.createElement('script');
    skeletonScript.src = assets.skeleton;
    skeletonScript.async = false;
    document.head.appendChild(skeletonScript);

    const apiClientScript = document.createElement('script');
    apiClientScript.src = assets.apiClient;
    apiClientScript.async = false;
    document.head.appendChild(apiClientScript);

    const storeScript = document.createElement('script');
    storeScript.src = assets.store;
    storeScript.async = false;
    document.head.appendChild(storeScript);

    const stateScript = document.createElement('script');
    stateScript.src = assets.state;
    stateScript.async = false;
    document.head.appendChild(stateScript);
})();
