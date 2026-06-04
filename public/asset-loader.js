(function() {
    // Check if running in a production-like environment.
    // Uses APP_CONFIG.ENVIRONMENT injected at build time
    const isProduction = window.APP_CONFIG?.ENVIRONMENT === 'production';

    // Define asset paths
    const assets = {
        css: isProduction ? '/dist/styles.min.css' : '/styles.css',
        app: isProduction ? '/dist/app.min.js' : '/frontend.js',
        enums: isProduction ? '/dist/enums.min.js' : '/enums.js',
        skeleton: isProduction ? '/dist/skeleton.min.js' : '/skeleton.js',
        apiClient: isProduction ? '/dist/api-client.min.js' : '/api-client.js',
        lruMap: isProduction ? '/dist/lru-map.min.js' : '/lib/lru-map.js',
        store: isProduction ? '/dist/store.min.js' : '/store.js',
        swRegistration: isProduction ? '/dist/service-worker-registration.min.js' : '/service-worker-registration.js',
        connectionBanner: isProduction ? '/dist/connection-banner.min.js' : '/connection-banner.js'
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

    // App-code deps: enums + skeleton + api-client + lru-map + store MUST load
    // and execute before frontend.js (frontend.js throws if any global is
    // missing). Dynamically-inserted scripts default to async:true (no ordering
    // guarantee), so we force async=false to preserve insertion order — the
    // standard pattern for ordered dynamic loads.
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

    const lruMapScript = document.createElement('script');
    lruMapScript.src = assets.lruMap;
    lruMapScript.async = false;
    document.head.appendChild(lruMapScript);

    const storeScript = document.createElement('script');
    storeScript.src = assets.store;
    storeScript.async = false;
    document.head.appendChild(storeScript);

    const appScript = document.createElement('script');
    appScript.src = assets.app;
    appScript.async = false;
    document.head.appendChild(appScript);
})();
