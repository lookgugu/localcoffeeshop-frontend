/**
 * URL privacy — load as a parser-blocking script BEFORE /analytics-init.js
 * configures the Google tag. Every page that loads gtag.js loads both, in
 * that order (tests/unit/analytics-pages.test.js).
 *
 * Removes from the address bar (history.replaceState, no reload):
 *   - free-text search params (q, search, query, s, keyword, term): GA's
 *     enhanced-measurement site search would otherwise report them;
 *   - waitlist tokens (?token= or #token=, even empty) and email params;
 *   - any param or fragment whose value contains "@" (email addresses).
 * Key matching is case-insensitive (?Q=, #TOKEN=).
 *
 * The values the page legitimately needs (the initial search, the token)
 * are handed over in memory, each readable once:
 *   window.LcsUrlPrivacy.takeInitialQuery() / .takeToken()
 *
 * analyticsFields() returns the page_location / page_referrer that
 * analytics-init.js passes to gtag('config'). Both are always explicit:
 * gtag would otherwise send document.referrer as-is, and a referrer from a
 * page without this script (or from before it ran) can carry ?q= or an
 * email. A referrer that can't be parsed is reduced to nothing.
 *
 * UMD: the browser gets window.LcsUrlPrivacy (already scrubbed); tests
 * import sanitize/pageLocation/safeReferrer/scrub.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.LcsUrlPrivacy = factory().scrub(root);
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var QUERY_KEYS = ['q', 'search', 'query', 's', 'keyword', 'term'];
    // Keys dropped whatever their value (compared lower-cased).
    var SENSITIVE_KEY_RE = /^(e|q|search|query|s|keyword|term)$|token|e-?mail|passw|secret/;
    // An embedded assignment of a sensitive key inside another value, e.g.
    // ?next=/?q=x or ?a=1;token=y (URLSearchParams doesn't split on ";").
    var EMBEDDED_RE = /(^|[?&;#/\s])(e|q|search|query|s|keyword|term|[a-z_-]*token|[a-z_-]*e-?mail|passw[a-z_]*|secret)\s*=/i;
    var MAX_QUERY = 100;
    var MAX_TOKEN = 1024;

    function decode(value) {
        try {
            return decodeURIComponent(String(value).replace(/\+/g, ' '));
        } catch (e) {
            return String(value);
        }
    }

    function hasAt(value) {
        return decode(value).indexOf('@') !== -1 || String(value).indexOf('@') !== -1;
    }

    function isSensitiveKey(key) {
        return SENSITIVE_KEY_RE.test(String(key).toLowerCase()) || hasAt(key);
    }

    function isSensitiveValue(value) {
        return hasAt(value) || EMBEDDED_RE.test(decode(value));
    }

    function isQueryKey(key) {
        return QUERY_KEYS.indexOf(String(key).toLowerCase()) !== -1;
    }

    /** A fragment is kept only if it's a plain anchor (no "=" or "@", no secrets). */
    function isSensitiveFragment(frag) {
        if (!frag) return false;
        var decoded = decode(frag);
        return decoded.indexOf('=') !== -1 || hasAt(frag) || /token|e-?mail|passw|secret/i.test(decoded);
    }

    /**
     * @param {string} href absolute URL (throws if it can't be parsed)
     * @returns {{ url: URL, clean: string, captured: { q: string|null, token: string|null } }}
     *   `clean` is path + query + hash, with secrets removed (for the address bar).
     */
    function sanitize(href) {
        var url = new URL(href);
        var captured = { q: null, token: null };
        var params = url.searchParams;
        var queryRank = QUERY_KEYS.length;

        var drop = [];
        params.forEach(function (value, key) {
            var lower = key.toLowerCase();
            if (isQueryKey(lower) && value.trim() !== '') {
                var rank = QUERY_KEYS.indexOf(lower);
                if (rank < queryRank) {
                    queryRank = rank;
                    captured.q = value.slice(0, MAX_QUERY);
                }
            }
            if (lower === 'token' && value && captured.token === null) captured.token = value.slice(0, MAX_TOKEN);
            if (isSensitiveKey(key) || isSensitiveValue(value)) drop.push(key);
        });
        for (var k = 0; k < drop.length; k++) params.delete(drop[k]);
        // A now-empty "?" would still change the URL string; drop it too.
        if (!params.toString()) url.search = '';

        if (url.hash) {
            var frag = url.hash.slice(1);
            if (frag.indexOf('=') !== -1) {
                new URLSearchParams(frag).forEach(function (value, key) {
                    if (key.toLowerCase() === 'token' && value) captured.token = value.slice(0, MAX_TOKEN);
                });
            }
            if (isSensitiveFragment(frag)) url.hash = '';
        }

        return { url: url, clean: url.pathname + url.search + url.hash, captured: captured };
    }

    /** Path with any segment holding an "@" replaced (e.g. a 404 for /me@x.com). */
    function safePath(pathname) {
        return pathname.split('/').map(function (seg) {
            return hasAt(seg) || (seg.indexOf('=') !== -1 && /token|e-?mail/i.test(decode(seg))) ? 'redacted' : seg;
        }).join('/');
    }

    /** Absolute sanitised URL for analytics: no secrets, no fragment. */
    function pageLocation(href) {
        var url = sanitize(href).url;
        return url.origin + safePath(url.pathname) + url.search;
    }

    /**
     * The referrer as analytics may see it: sanitised like pageLocation, ''
     * for none, and '' if it can't be parsed or isn't http(s) (fail closed).
     */
    function safeReferrer(referrer) {
        if (!referrer) return '';
        try {
            var url = new URL(referrer);
            if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
            if (url.username || url.password) return url.protocol + '//' + url.host + '/';
            return pageLocation(url.href);
        } catch (e) {
            return '';
        }
    }

    /** Scrub `win`'s address bar now; return the one-time accessors. */
    function scrub(win) {
        var initial = { q: null, token: null };
        var originalHref = null;
        try {
            var loc = win.location;
            originalHref = loc.href;
            var out = sanitize(originalHref);
            initial = out.captured;
            var current = loc.pathname + loc.search + loc.hash;
            if (out.clean !== current && win.history && typeof win.history.replaceState === 'function') {
                win.history.replaceState(win.history.state, '', out.clean);
            }
        } catch (e) {
            // Never break the page over this.
        }
        function take(key) {
            var v = initial[key];
            initial[key] = null;
            return v === undefined ? null : v;
        }
        /**
         * Fields for gtag('config'), or null if they can't be computed safely
         * (analytics-init.js then doesn't configure the tag at all).
         */
        function analyticsFields() {
            try {
                var doc = win.document;
                return {
                    page_location: pageLocation(originalHref),
                    page_referrer: safeReferrer(doc ? doc.referrer : '')
                };
            } catch (e) {
                return null;
            }
        }
        return {
            sanitize: sanitize,
            pageLocation: pageLocation,
            safeReferrer: safeReferrer,
            analyticsFields: analyticsFields,
            takeInitialQuery: function () { return take('q'); },
            takeToken: function () { return take('token'); }
        };
    }

    return { sanitize: sanitize, pageLocation: pageLocation, safeReferrer: safeReferrer, scrub: scrub };
});
