(function() {
    // Check if running in a production-like environment.
    // Uses APP_CONFIG.ENVIRONMENT injected at build time
    const isProduction = window.APP_CONFIG?.ENVIRONMENT === 'production';

    // Define asset paths
    const assets = {
        css: isProduction ? '/dist/styles.min.css' : '/styles.css',
        app: isProduction ? '/dist/app.min.js' : '/frontend.js',
        constants: isProduction ? '/dist/constants.min.js' : '/constants.js'
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

    const appScript = document.createElement('script');
    appScript.src = assets.app;
    appScript.defer = true;
    document.head.appendChild(appScript);
})();
