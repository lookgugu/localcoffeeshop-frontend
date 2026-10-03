/**
 * Content Security Policy for every HTML page the site serves (#14).
 *
 * Production is a DigitalOcean App Platform static site (.do/app-spec.yaml),
 * which cannot set custom response headers, so the policy ships as a
 * <meta http-equiv="Content-Security-Policy"> tag placed directly after
 * <meta charset> in each page (a meta CSP only governs what comes after it).
 *
 * This file is the source of truth. The hand-written pages (public/html/*.html,
 * public/pages/*.html) carry a copy of CSP_META_TAG, and
 * scripts/prerender-states.cjs emits it for the generated state pages.
 * tests/unit/csp.test.js fails if any served page is missing it or has a
 * stale copy, so a change here means updating the pages too.
 *
 * Not settable from a meta tag (browsers ignore them there): frame-ancestors,
 * report-uri/report-to and sandbox, plus the X-Frame-Options and
 * X-Content-Type-Options headers. See the PR for #14.
 *
 * Allowed third parties, and why:
 * - www.googletagmanager.com: gtag.js (script) and its hits.
 * - *.google-analytics.com, *.analytics.google.com, *.g.doubleclick.net,
 *   *.google.com: GA4 collection endpoints (region1.google-analytics.com etc.;
 *   doubleclick/google.com only if Google signals is on). Per Google's CSP
 *   guide: https://developers.google.com/tag-platform/security/guides/csp
 * - Advertising features (Google signals; consent-banner.js grants
 *   ad_storage/ad_user_data/ad_personalization on "Accept All"), per the same
 *   guide: frame-src www.googletagmanager.com (the tag may create an iframe,
 *   which default-src 'self' would block) and connect-src
 *   pagead2.googlesyndication.com. The guide also lists https://*.google.<TLD>
 *   for each country TLD; CSP can't wildcard a TLD, and this is a US site, so
 *   only *.google.com is listed (a non-.com hit is dropped, nothing breaks).
 * - fonts.googleapis.com / fonts.gstatic.com: Source Sans Pro on about and
 *   contact pages.
 * - api.localcoffeeshop.co: the API (API_BASE_URL in .do/app-spec.yaml).
 *   http://localhost:3000 is the documented local-dev API (README), so
 *   `npm run dev` against a local backend keeps working.
 *
 * 'unsafe-inline' in script-src is needed for the inline gtag/consent
 * bootstrap scripts, the contact form script and onclick handlers in
 * submit.html; in style-src for style="" attributes. JSON-LD blocks are not
 * executed, so CSP doesn't affect them.
 */
const CSP_DIRECTIVES = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://www.googletagmanager.com https://*.google-analytics.com https://*.g.doubleclick.net https://*.google.com",
    "connect-src 'self' https://api.localcoffeeshop.co http://localhost:3000 https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com https://*.g.doubleclick.net https://*.google.com https://pagead2.googlesyndication.com",
    "frame-src 'self' https://www.googletagmanager.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
];

const CSP_POLICY = CSP_DIRECTIVES.join('; ');

const CSP_META_TAG = `<meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}">`;

// Same value the netlify.toml header used to promise; browsers already
// default to it, this makes it explicit.
const REFERRER_META_TAG = '<meta name="referrer" content="strict-origin-when-cross-origin">';

module.exports = { CSP_DIRECTIVES, CSP_POLICY, CSP_META_TAG, REFERRER_META_TAG };
