/**
 * Shop actions: the "Directions" and "Website" links on a shop card.
 *
 * Used by the homepage search results (frontend.js), the interactive state
 * page (html/state.js) and, at build time, the prerendered state pages
 * (scripts/prerender-states.cjs), so all three link the same way.
 *
 * UMD-style: works as CommonJS in Node (tests, prerender) and attaches
 * `window.CoffeeShopActions` in the browser.
 *
 * Safety rules:
 *   - Directions: Google Maps with "name, full address" as the destination,
 *     URL-encoded. Only offered when there is an address.
 *   - Website: only when the API record carries an http(s) URL (Google
 *     Places' `websiteUri`, or `website` as the submit form sends it).
 *     Other schemes (javascript:, data:, ...), relative URLs and URLs with
 *     embedded credentials are dropped. Nothing is derived from the name.
 *   - Same tab (no target), so the destination never gets window.opener;
 *     rel="noopener noreferrer" keeps the referrer out of third-party logs.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  } else if (typeof window !== 'undefined') {
    window.CoffeeShopActions = mod;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIRECTIONS_BASE = 'https://www.google.com/maps/dir/?api=1&destination=';
  const DIRECTIONS_REL = 'noopener noreferrer';
  // Listings are third-party/user-submitted: don't pass link equity.
  const WEBSITE_REL = 'noopener noreferrer nofollow ugc';
  const WEBSITE_FIELDS = ['websiteUri', 'website'];

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function shopName(shop) {
    return text(shop && shop.displayName && shop.displayName.text);
  }

  /** Google Maps directions URL for the shop, or null without an address. */
  function directionsUrl(shop) {
    const address = text(shop && shop.formattedAddress);
    if (!address) return null;
    const name = shopName(shop);
    const destination = name ? `${name}, ${address}` : address;
    return DIRECTIONS_BASE + encodeURIComponent(destination);
  }

  /** The shop's own website if it is a safe absolute http(s) URL, else null. */
  function websiteUrl(shop) {
    if (!shop) return null;
    for (const field of WEBSITE_FIELDS) {
      const raw = text(shop[field]);
      if (!raw || !/^https?:\/\//i.test(raw)) continue;
      let url;
      try {
        url = new URL(raw);
      } catch (err) {
        continue;
      }
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) continue;
      return raw;
    }
    return null;
  }

  /** [{ kind, href, label, ariaLabel, rel }] for the shop, possibly empty. */
  function shopActions(shop) {
    const name = shopName(shop) || 'this coffee shop';
    const list = [];
    const directions = directionsUrl(shop);
    if (directions) {
      list.push({
        kind: 'directions',
        href: directions,
        label: 'Directions',
        ariaLabel: `Directions to ${name} on Google Maps`,
        rel: DIRECTIONS_REL,
      });
    }
    const website = websiteUrl(shop);
    if (website) {
      list.push({
        kind: 'website',
        href: website,
        label: 'Website',
        ariaLabel: `${name} website`,
        rel: WEBSITE_REL,
      });
    }
    return list;
  }

  /** <div class="shop-actions"> with the links, or null when there are none. */
  function createShopActions(doc, shop) {
    const list = shopActions(shop);
    if (!list.length) return null;
    const container = doc.createElement('div');
    container.className = 'shop-actions';
    for (const action of list) {
      const a = doc.createElement('a');
      a.className = `shop-action shop-action-${action.kind}`;
      a.href = action.href;
      a.rel = action.rel;
      a.textContent = action.label;
      a.setAttribute('aria-label', action.ariaLabel);
      container.appendChild(a);
    }
    return container;
  }

  /** Static-HTML version of createShopActions ('' when there are no links). */
  function renderShopActionsHtml(shop, escapeHtml) {
    const list = shopActions(shop);
    if (!list.length) return '';
    const links = list.map((action) =>
      `<a class="shop-action shop-action-${action.kind}" href="${escapeHtml(action.href)}" rel="${action.rel}" aria-label="${escapeHtml(action.ariaLabel)}">${escapeHtml(action.label)}</a>`);
    return `<div class="shop-actions">${links.join('')}</div>`;
  }

  return {
    directionsUrl,
    websiteUrl,
    shopActions,
    createShopActions,
    renderShopActionsHtml,
  };
});
