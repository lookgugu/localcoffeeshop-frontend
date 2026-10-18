// Google Consent Mode default + gtag config as an external script, for pages
// that carry no inline JavaScript (the generated /roasters/ page). Same
// commands, in the same order, as the inline blocks in public/html/*.html:
// load after /geo-consent-default.js and before gtag.js, so the consent
// default is queued before config.
(function () {
    'use strict';

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }

    var initialConsent = {
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        functionality_storage: 'granted',
        security_storage: 'granted',
        wait_for_update: 500
    };
    try {
        if (window.LocalCoffeeShopConsent) {
            initialConsent = window.LocalCoffeeShopConsent.getInitialConsentState() || initialConsent;
        }
    } catch (e) {}
    gtag('consent', 'default', initialConsent);

    gtag('js', new Date());
    gtag('config', 'G-YVSXN7PM48');
})();
