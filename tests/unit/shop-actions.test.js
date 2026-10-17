/**
 * Shop actions (public/shop-actions.js): the "Directions" and "Website" links
 * on shop cards (homepage search, interactive state page, prerendered state
 * pages).
 *
 * Contract:
 *   - Directions goes to Google Maps with the shop's name + full address as
 *     the destination, URL-encoded. No address -> no Directions link (a name
 *     alone is ambiguous).
 *   - Website only when the API record has a real http(s) URL. Anything else
 *     (javascript:, data:, relative paths, junk) -> no link. Nothing is
 *     fabricated from the name.
 *   - Links open in the same tab (no target, so no window.opener exposure),
 *     carry rel="noopener noreferrer", and have accessible names that say
 *     which shop they are for.
 */

import { describe, it, expect } from 'vitest';
import actions from '../../public/shop-actions.js';

const { directionsUrl, websiteUrl, createShopActions, renderShopActionsHtml } = actions;

const shop = (over = {}) => ({
  displayName: { text: 'Lone Star Roasters' },
  formattedAddress: '300 Congress Ave, Austin, TX 78701, USA',
  state: 'TX',
  ...over,
});

const escapeHtml = (v) => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

describe('directionsUrl', () => {
  it('encodes name + full address as the Google Maps directions destination', () => {
    const url = new URL(directionsUrl(shop()));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('destination')).toBe('Lone Star Roasters, 300 Congress Ave, Austin, TX 78701, USA');
  });

  it('percent-encodes characters that would otherwise break the query string', () => {
    const raw = directionsUrl(shop({ displayName: { text: 'Café & Co #1' }, formattedAddress: '1 A St?x=1, Reno, NV' }));
    const destination = raw.split('&destination=')[1];
    expect(destination).not.toMatch(/[ &#?]/);
    expect(raw).toContain('Caf%C3%A9%20%26%20Co%20%231');
    expect(new URL(raw).searchParams.get('destination')).toBe('Café & Co #1, 1 A St?x=1, Reno, NV');
  });

  it('uses the address alone when there is no name', () => {
    const url = new URL(directionsUrl(shop({ displayName: null })));
    expect(url.searchParams.get('destination')).toBe('300 Congress Ave, Austin, TX 78701, USA');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['non-string', { line1: 'x' }],
  ])('returns null when the address is %s', (_, formattedAddress) => {
    expect(directionsUrl(shop({ formattedAddress }))).toBeNull();
  });

  it('returns null for a missing shop', () => {
    expect(directionsUrl(null)).toBeNull();
  });
});

describe('websiteUrl', () => {
  it.each([
    ['websiteUri', 'https://lonestar.example/'],
    ['website', 'http://lonestar.example/menu'],
  ])('accepts an http(s) URL in %s', (field, value) => {
    expect(websiteUrl(shop({ [field]: value }))).toBe(value);
  });

  it('trims surrounding whitespace', () => {
    expect(websiteUrl(shop({ websiteUri: '  https://lonestar.example/  ' }))).toBe('https://lonestar.example/');
  });

  it.each([
    'javascript:alert(1)',
    ' JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://lonestar.example/',
    '//lonestar.example/',
    '/relative/path',
    'lonestar.example',
    'https://user:pass@lonestar.example/',
    'not a url',
    '',
  ])('rejects %j', (value) => {
    expect(websiteUrl(shop({ websiteUri: value }))).toBeNull();
  });

  it('returns null when no website field exists (never fabricated)', () => {
    expect(websiteUrl(shop())).toBeNull();
    expect(websiteUrl(shop({ websiteUri: 42 }))).toBeNull();
    expect(websiteUrl(null)).toBeNull();
  });
});

describe('createShopActions (DOM)', () => {
  it('renders an accessible same-tab Directions link', () => {
    const el = createShopActions(document, shop());
    expect(el.className).toBe('shop-actions');
    const links = el.querySelectorAll('a');
    expect(links).toHaveLength(1);
    const a = links[0];
    expect(a.textContent).toBe('Directions');
    expect(a.getAttribute('href')).toBe(directionsUrl(shop()));
    expect(a.getAttribute('aria-label')).toBe('Directions to Lone Star Roasters on Google Maps');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.hasAttribute('target')).toBe(false);
  });

  it('adds a Website link only for a safe URL', () => {
    const el = createShopActions(document, shop({ websiteUri: 'https://lonestar.example/' }));
    const site = el.querySelector('a.shop-action-website');
    expect(site.getAttribute('href')).toBe('https://lonestar.example/');
    expect(site.textContent).toBe('Website');
    expect(site.getAttribute('aria-label')).toBe('Lone Star Roasters website');
    expect(site.getAttribute('rel')).toBe('noopener noreferrer nofollow ugc');
    expect(site.hasAttribute('target')).toBe(false);

    const unsafe = createShopActions(document, shop({ websiteUri: 'javascript:alert(1)' }));
    expect(unsafe.querySelector('a.shop-action-website')).toBeNull();
  });

  it('treats a hostile name as text, not markup', () => {
    const el = createShopActions(document, shop({ displayName: { text: '<img src=x onerror=alert(1)>' } }));
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('a').getAttribute('aria-label')).toBe('Directions to <img src=x onerror=alert(1)> on Google Maps');
  });

  it('returns null when there is nothing to link to', () => {
    expect(createShopActions(document, shop({ formattedAddress: '' }))).toBeNull();
  });
});

describe('renderShopActionsHtml (prerendered pages)', () => {
  it('matches the DOM version and escapes every attribute', () => {
    const html = renderShopActionsHtml(shop({
      displayName: { text: 'Joe\'s "Best" <Brew>' },
      websiteUri: 'https://joes.example/?a=1&b=2',
    }), escapeHtml);
    const host = document.createElement('div');
    host.innerHTML = html;
    const [dir, site] = host.querySelectorAll('a');
    expect(dir.getAttribute('aria-label')).toBe('Directions to Joe\'s "Best" <Brew> on Google Maps');
    expect(new URL(dir.getAttribute('href')).searchParams.get('destination'))
      .toBe('Joe\'s "Best" <Brew>, 300 Congress Ave, Austin, TX 78701, USA');
    expect(site.getAttribute('href')).toBe('https://joes.example/?a=1&b=2');
    expect(html).not.toMatch(/<Brew>/);
    expect(html).not.toMatch(/target=/);
  });

  it('is empty when there is nothing to link to', () => {
    expect(renderShopActionsHtml(shop({ formattedAddress: null }), escapeHtml)).toBe('');
  });
});
