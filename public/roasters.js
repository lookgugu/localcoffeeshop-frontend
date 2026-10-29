/**
 * Roaster directory search + state filter (/roasters/, #50).
 *
 * Progressive enhancement over the page scripts/roasters.cjs prerenders:
 * every listing is already in the HTML, so without JavaScript the page is a
 * complete list. This reveals the filter form, hides cards that don't match,
 * announces the result count in #roasterStatus, shows the empty state with a
 * reset, and mirrors the state filter to ?state= (replaceState, no reload) so
 * a filtered view can be bookmarked or shared. The search text is never put in
 * the URL (GA reads page_location on history changes); a ?q= deep link is
 * handed over once by url-privacy.js, which scrubbed it before analytics.
 *
 * Analytics (optional, via window.LcsAnalytics): one debounced
 * `roaster_filter` per distinct settled filter (categorical only). Store
 * clicks are deliberately NOT tracked here: GA4's enhanced-measurement
 * outbound `click` (link_classes = roaster-shop, link_url = the catalog
 * merchant URL) is the one canonical bean-store click metric, so a custom
 * event would double count it.
 *
 * UMD like the other public scripts: the browser gets window.CoffeeRoasterFilter
 * (and it initialises itself); tests import the pure helpers.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.CoffeeRoasterFilter = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /** Lowercased, accent-free, single-spaced; matches searchText() in scripts/roasters.cjs. */
    function normalize(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    /** { q, state } from a query string; a state not in `states` is ignored. */
    function readParams(search, states) {
        const params = new URLSearchParams(search || '');
        const state = params.get('state') || '';
        return {
            q: (params.get('q') || '').slice(0, 100),
            state: states.indexOf(state) === -1 ? '' : state,
        };
    }

    /** The page URL with state set (or dropped when empty), q always dropped; other params and the hash kept. */
    function buildUrl(pathname, search, hash, filters) {
        const params = new URLSearchParams(search || '');
        params.delete('q');
        params.delete('state');
        if (filters.state) params.set('state', filters.state);
        const query = params.toString();
        return pathname + (query ? `?${query}` : '') + (hash || '');
    }

    function matches(card, q, state) {
        if (state && card.getAttribute('data-state') !== state) return false;
        if (!q) return true;
        return normalize(card.getAttribute('data-name')).indexOf(q) !== -1
            || normalize(card.getAttribute('data-city')).indexOf(q) !== -1;
    }

    const FILTER_TRACK_DELAY_MS = 1000;

    function analyticsOf(win) {
        const a = win && win.LcsAnalytics;
        return a && typeof a.track === 'function' ? a : null;
    }

    function track(win, name, params) {
        try {
            const a = analyticsOf(win);
            if (a) a.track(name, params);
        } catch (e) {
            // analytics must never break the page
        }
    }

    const plural = (n) => `roaster${n === 1 ? '' : 's'}`;

    function statusText(shown, total, rawQuery, stateLabel) {
        const parts = [];
        if (rawQuery) parts.push(`matching “${rawQuery}”`);
        if (stateLabel) parts.push(`in ${stateLabel}`);
        if (!parts.length) return `Showing all ${total} ${plural(total)}.`;
        if (!shown) return `No roasters match ${parts.join(' ').replace(/^matching /, '')}.`;
        return `Showing ${shown} of ${total} ${plural(total)} ${parts.join(' ')}.`;
    }

    /** Wire up the page. Returns { apply } (for tests), or null if the page lacks the list. */
    function init(doc, win) {
        const form = doc.getElementById('roasterFilters');
        const input = doc.getElementById('roasterSearch');
        const select = doc.getElementById('roasterState');
        const status = doc.getElementById('roasterStatus');
        const empty = doc.getElementById('roasterEmpty');
        const emptyReset = doc.getElementById('roasterEmptyReset');
        const list = doc.getElementById('roasterList');
        if (!form || !input || !select || !status || !list) return null;

        const cards = Array.prototype.slice.call(list.querySelectorAll('.roaster-card'));
        const states = Array.prototype.map.call(select.options, (o) => o.value).filter(Boolean);
        // "Maine (4)" -> "Maine"
        const stateLabel = (code) => {
            const opt = Array.prototype.find.call(select.options, (o) => o.value === code);
            return opt ? opt.textContent.replace(/\s*\(\d+\)\s*$/, '') : '';
        };

        let trackTimer = null;
        let lastTracked = null;

        function scheduleFilterTrack(q, state, shown) {
            if (trackTimer) clearTimeout(trackTimer);
            trackTimer = setTimeout(() => {
                trackTimer = null;
                const signature = JSON.stringify([q, state]);
                if (signature === lastTracked) return;
                lastTracked = signature;
                track(win, 'roaster_filter', {
                    filter_has_query: q ? 'yes' : 'no',
                    filter_state: state || 'all',
                    result_count: shown,
                });
            }, FILTER_TRACK_DELAY_MS);
        }

        function apply({ updateUrl = true } = {}) {
            const rawQuery = input.value.trim();
            const q = normalize(rawQuery);
            const state = select.value;
            let shown = 0;
            for (const card of cards) {
                const visible = matches(card, q, state);
                card.hidden = !visible;
                if (visible) shown++;
            }
            if (empty) empty.hidden = shown !== 0;
            // textContent: the query is user input, never markup
            status.textContent = statusText(shown, cards.length, rawQuery, state ? stateLabel(state) : '');
            if (updateUrl && win.history && win.history.replaceState) {
                const loc = win.location;
                const next = buildUrl(loc.pathname, loc.search, loc.hash, { q: rawQuery, state });
                if (next !== loc.pathname + loc.search + loc.hash) win.history.replaceState(null, '', next);
            }
            if (updateUrl) scheduleFilterTrack(q, state, shown);
        }

        function reset() {
            input.value = '';
            select.value = '';
            apply();
            input.focus();
        }

        const initial = readParams(win.location.search, states);
        const privacy = win.LcsUrlPrivacy;
        const handedOver = privacy && typeof privacy.takeInitialQuery === 'function' ? privacy.takeInitialQuery() : null;
        if (handedOver) initial.q = handedOver.slice(0, 100);
        input.value = initial.q;
        // The initial render is not a user filter, so it is not tracked.
        lastTracked = JSON.stringify([normalize(initial.q), initial.state]);
        select.value = initial.state;

        input.addEventListener('input', () => apply());
        select.addEventListener('change', () => apply());
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            apply();
        });
        // A native reset restores the controls after this handler runs, so
        // clear them ourselves and cancel it.
        form.addEventListener('reset', (event) => {
            event.preventDefault();
            reset();
        });
        if (emptyReset) emptyReset.addEventListener('click', reset);

        form.hidden = false;
        apply({ updateUrl: false });
        return { apply };
    }

    if (typeof document !== 'undefined' && typeof window !== 'undefined'
        && document.getElementById && document.getElementById('roasterList')) {
        init(document, window);
    }

    return { normalize, readParams, buildUrl, init };
});
