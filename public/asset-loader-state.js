(function() {
    // Check if running in a production-like environment.
    const isProduction = window.location.hostname === 'localcoffeeshop.co';

    // Define asset paths
    const assets = {
        css: isProduction ? '/dist/styles.min.css' : '/styles.css',
        enums: isProduction ? '/dist/enums.min.js' : '/enums.js',
        skeleton: isProduction ? '/dist/skeleton.min.js' : '/skeleton.js',
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

    // App-code deps: enums + skeleton MUST load and execute before state.js
    // (state.js throws if either global is missing). Dynamically-inserted scripts
    // default to async:true (no ordering guarantee), so we force async=false to
    // preserve insertion order.
    const enumsScript = document.createElement('script');
    enumsScript.src = assets.enums;
    enumsScript.async = false;
    document.head.appendChild(enumsScript);

    const skeletonScript = document.createElement('script');
    skeletonScript.src = assets.skeleton;
    skeletonScript.async = false;
    document.head.appendChild(skeletonScript);

    const stateScript = document.createElement('script');
    stateScript.src = assets.state;
    stateScript.async = false;
    document.head.appendChild(stateScript);
})();
