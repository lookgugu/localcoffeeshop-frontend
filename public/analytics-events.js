/**
 * Privacy-safe custom analytics events.
 *
 *   window.LcsAnalytics.track(name, params)
 *
 * Only event names in SCHEMAS are sent, each only with its allowlisted
 * parameters, each value validated as a fixed category, a bounded count or
 * a slug id. Everything else is dropped — raw search text, email addresses,
 * tokens and unknown keys never reach Google Analytics. Every event carries
 * an explicit send_to. Consent is untouched: gtag applies whatever Consent
 * Mode state the page set (denied → cookieless ping, blocked gtag → nothing).
 *
 * Bean-store clicks are NOT a custom event: the one canonical metric is
 * GA4's enhanced-measurement outbound `click` (filter link_classes =
 * roaster-shop, link_url = the catalog merchant URL). See README.
 *
 * Event meanings (keep reports honest; page_view / form_start / the
 * outbound click are different metrics: never sum them with these):
 *   directory_search         a homepage search a person ran settled (once per
 *                            distinct search; a deep-linked initial render is
 *                            not a search)
 *   roaster_filter           a /roasters/ filter settled (debounced, distinct)
 *   waitlist_signup_attempt  the interest form sent a request
 *   waitlist_request_accepted the backend answered 202 pending_confirmation.
 *                            That is a REQUEST accepted, not an email sent:
 *                            the backend answers the same 202 for honeypot,
 *                            suppressed and globally-unsubscribed addresses
 *                            without sending anything (anti-enumeration).
 *                            The real provider hand-off is the backend's
 *                            waitlist_confirmation_sent log, never a browser
 *                            event. Not a confirmed signup either.
 *   waitlist_signup_error    the request failed (error_code says why)
 *   waitlist_confirmed       the backend answered status `confirmed` with
 *                            conversion `observed_new` to an explicit confirm
 *                            POST (never on page visit, replay or an ambiguous
 *                            add). Best-effort, not a deduplicated count.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.LcsAnalytics = factory().bind(root);
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var MEASUREMENT_ID = 'G-YVSXN7PM48';
    var PRICE = {
        PRICE_LEVEL_INEXPENSIVE: 'inexpensive',
        PRICE_LEVEL_MODERATE: 'moderate',
        PRICE_LEVEL_EXPENSIVE: 'expensive',
        PRICE_LEVEL_VERY_EXPENSIVE: 'very_expensive'
    };

    function oneOf(values) {
        return function (v) { return values.indexOf(v) !== -1 ? v : undefined; };
    }
    function count(v) {
        return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1000000 ? v : undefined;
    }
    function stateOrAll(v) {
        return v === 'all' || (typeof v === 'string' && /^[A-Z]{2}$/.test(v)) ? v : undefined;
    }
    function price(v) {
        if (v === 'any') return v;
        return Object.prototype.hasOwnProperty.call(PRICE, v) ? PRICE[v] : undefined;
    }
    var yesNo = oneOf(['yes', 'no']);
    var source = oneOf(['home', 'roasters']);

    var SCHEMAS = {
        directory_search: { search_has_query: yesNo, search_state: stateOrAll, search_price: price, result_count: count },
        roaster_filter: { filter_has_query: yesNo, filter_state: stateOrAll, result_count: count },
        waitlist_signup_attempt: { waitlist_source: source },
        waitlist_request_accepted: { waitlist_source: source },
        waitlist_signup_error: {
            waitlist_source: source,
            error_code: oneOf(['validation', 'rate_limited', 'unavailable', 'provider', 'network', 'unknown'])
        },
        waitlist_confirmed: { confirm_result: oneOf(['confirmed']) }
    };

    /** @returns {object|false} the params sent, or false if nothing was sent */
    function track(name, params, win) {
        if (!Object.prototype.hasOwnProperty.call(SCHEMAS, name)) return false;
        var schema = SCHEMAS[name];
        var clean = {};
        var input = params || {};
        Object.keys(schema).forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(input, key)) return;
            var value = schema[key](input[key]);
            if (value !== undefined) clean[key] = value;
        });
        clean.send_to = MEASUREMENT_ID;

        var w = win || {};
        try {
            if (typeof w.gtag === 'function') {
                w.gtag('event', name, clean);
            } else if (w.dataLayer && typeof w.dataLayer.push === 'function') {
                // gtag.js only processes Arguments objects; mirror its stub.
                (function () { w.dataLayer.push(arguments); })('event', name, clean);
            } else {
                return false;
            }
        } catch (e) {
            return false;
        }
        return clean;
    }

    return {
        MEASUREMENT_ID: MEASUREMENT_ID,
        SCHEMAS: SCHEMAS,
        track: track,
        /** Bound browser API: window.LcsAnalytics.track(name, params). */
        bind: function (win) {
            return { track: function (name, params) { return track(name, params, win); } };
        }
    };
});
