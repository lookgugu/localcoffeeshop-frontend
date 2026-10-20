// Google Consent Mode default + gtag config as an external script, shared by
// EVERY page that loads gtag.js (homepage, state, submit, about, 404,
// /roasters/, /waitlist/*). Load order, all parser-blocking except gtag.js:
//   /config.js, /geo-consent-default.js, /url-privacy.js, /analytics-init.js,
//   <async gtag.js>
// so the consent default is queued first and the address bar has been
// scrubbed before the tag is configured.
//
// Referrer / location privacy: gtag would otherwise send document.referrer
// and the page URL as-is, and a same-origin referrer can carry ?q=, an email
// or a token. The first config therefore always passes explicit, sanitised
// page_location and page_referrer from /url-privacy.js. FAIL CLOSED: if that
// helper is missing, blocked, throws or returns anything unexpected, the tag
// is NOT configured and Google's documented opt-out flag
// (window['ga-disable-<ID>']) is set, so nothing is sent. There is no raw
// fallback.
(function () {
    'use strict';

    var MEASUREMENT_ID = 'G-YVSXN7PM48';

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

    var fields = null;
    try {
        var privacy = window.LcsUrlPrivacy;
        fields = privacy && typeof privacy.analyticsFields === 'function' ? privacy.analyticsFields() : null;
    } catch (e) {
        fields = null;
    }

    if (!fields || typeof fields.page_location !== 'string' || typeof fields.page_referrer !== 'string') {
        window['ga-disable-' + MEASUREMENT_ID] = true;
        return;
    }

    gtag('js', new Date());
    gtag('config', MEASUREMENT_ID, {
        page_location: fields.page_location,
        page_referrer: fields.page_referrer
    });
})();
