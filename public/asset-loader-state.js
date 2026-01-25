(function() {
    // Check if running in a production-like environment.
    const isProduction = window.location.hostname === 'localcoffeeshop.co';

    // Define asset paths
    const assets = {
        css: isProduction ? '/dist/styles.min.css' : '/styles.css',
        constants: isProduction ? '/dist/constants.min.js' : '/constants.js',
        state: isProduction ? '/dist/state.min.js' : '/html/state.js'
    };

    // Load CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = assets.css;
    document.head.appendChild(link);

    // Load critical scripts
    const consentScript = document.createElement('script');
    consentScript.src = '/consent-banner.js';
    document.head.appendChild(consentScript);

    const analyticsScript = document.createElement('script');
    analyticsScript.src = '/analytics.js';
    analyticsScript.async = true;
    document.head.appendChild(analyticsScript);

    // Load app scripts
    const constantsScript = document.createElement('script');
    constantsScript.src = assets.constants;
    document.head.appendChild(constantsScript);

    const stateScript = document.createElement('script');
    stateScript.src = assets.state;
    stateScript.defer = true;
    document.head.appendChild(stateScript);
})();
