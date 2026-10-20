/**
 * Roaster directory search + state filter (public/roasters.js, #50)
 *
 * The page is prerendered by scripts/roasters.cjs with every listing in the
 * HTML; roasters.js reveals the (initially hidden) filter form, hides
 * non-matching cards, announces the result count, shows an empty state with
 * a reset, and keeps ?state= in the URL so filtered views can be shared. Raw
 * search text is never written to the URL (GA would read it from page_location);
 * a ?q= deep link is read once (via url-privacy.js) and scrubbed.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import filter from '../../../public/roasters.js';

const require = createRequire(import.meta.url);
const { renderRoastersPage } = require('../../../scripts/roasters.cjs');

const base = (id, name, city, state) => ({
  id, name, city, state,
  website: `https://${id}.test/`,
  shopUrl: `https://${id}.test/shop`,
  checkedAt: '2026-10-18',
  sources: [{ url: `https://${id}.test/contact`, evidence: `Address in ${city}` }],
  shipping: { status: 'unknown' },
  pickup: { status: 'unknown' },
});

const DATA = {
  version: 1,
  roasters: [
    base('acme', 'Acme Coffee', 'Somerville', 'MA'),
    base('bean', 'Bean Roasters', 'Portland', 'ME'),
    base('cafe', 'Café Brûlé', 'Providence', 'RI'),
  ],
};

function mount(url = '/roasters/') {
  delete window.LcsUrlPrivacy;
  delete window.LcsAnalytics;
  window.history.replaceState(null, '', url);
  const html = renderRoastersPage(DATA);
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  return filter.init(document, window);
}

const $ = (sel) => document.querySelector(sel);
const visibleNames = () => [...document.querySelectorAll('.roaster-card')]
  .filter((li) => !li.hidden).map((li) => li.querySelector('.roaster-name').textContent);
const type = (value) => {
  const input = $('#roasterSearch');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const choose = (value) => {
  const select = $('#roasterState');
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('roaster filter: pure helpers', () => {
  it('normalizes case, accents and spacing', () => {
    expect(filter.normalize('  Café BRÛLÉ ')).toBe('cafe brule');
  });

  it('reads q and state from a query string, ignoring unknown states', () => {
    expect(filter.readParams('?q=bean&state=ME', ['MA', 'ME'])).toEqual({ q: 'bean', state: 'ME' });
    expect(filter.readParams('?state=ZZ', ['MA'])).toEqual({ q: '', state: '' });
    expect(filter.readParams('', ['MA'])).toEqual({ q: '', state: '' });
  });

  it('writes only the filters in use, keeping other params and the hash', () => {
    expect(filter.buildUrl('/roasters/', '?utm=x', '#roaster-acme', { q: 'bean', state: '' })).toBe('/roasters/?utm=x#roaster-acme');
    expect(filter.buildUrl('/roasters/', '?q=old&state=MA', '', { q: '', state: '' })).toBe('/roasters/');
    expect(filter.buildUrl('/roasters/', '', '', { q: 'bean', state: 'ME' })).toBe('/roasters/?state=ME');
  });
});

describe('roaster filter: page behavior', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('shows the filters only once JavaScript runs; all listings are already in the HTML', () => {
    const html = renderRoastersPage(DATA);
    expect(html).toMatch(/<form[^>]+id="roasterFilters"[^>]*hidden/);
    expect((html.match(/class="roaster-card"/g) || []).length).toBe(3);
    mount();
    expect($('#roasterFilters').hidden).toBe(false);
    expect(visibleNames()).toEqual(['Acme Coffee', 'Bean Roasters', 'Café Brûlé']);
  });

  it('filters by name or city, accent-insensitively, and announces the count', () => {
    mount();
    type('portland');
    expect(visibleNames()).toEqual(['Bean Roasters']);
    expect($('#roasterStatus').textContent).toBe('Showing 1 of 3 roasters matching “portland”.');
    type('cafe brule');
    expect(visibleNames()).toEqual(['Café Brûlé']);
  });

  it('filters by state and combines with search', () => {
    mount();
    choose('MA');
    expect(visibleNames()).toEqual(['Acme Coffee']);
    expect($('#roasterStatus').textContent).toBe('Showing 1 of 3 roasters in Massachusetts.');
    type('bean');
    expect(visibleNames()).toEqual([]);
  });

  it('shows an empty state with a reset that restores everything and returns focus to search', () => {
    mount();
    type('nothing like this');
    expect(visibleNames()).toEqual([]);
    expect($('#roasterEmpty').hidden).toBe(false);
    expect($('#roasterStatus').textContent).toBe('No roasters match “nothing like this”.');
    $('#roasterEmptyReset').click();
    expect(visibleNames()).toHaveLength(3);
    expect($('#roasterEmpty').hidden).toBe(true);
    expect($('#roasterSearch').value).toBe('');
    expect(document.activeElement).toBe($('#roasterSearch'));
    expect($('#roasterStatus').textContent).toBe('Showing all 3 roasters.');
  });

  it('the form reset button clears filters too', () => {
    mount();
    choose('ME');
    $('#roasterFilters').dispatchEvent(new Event('reset', { bubbles: true }));
    expect(visibleNames()).toHaveLength(3);
    expect($('#roasterState').value).toBe('');
  });

  it('keeps the state filter (never the search text) in the URL, and restores deep links', () => {
    mount();
    type('bean');
    choose('ME');
    expect(window.location.search).toBe('?state=ME');
    expect(window.location.href).not.toContain('bean');
    mount('/roasters/?state=RI');
    expect($('#roasterState').value).toBe('RI');
    expect(visibleNames()).toEqual(['Café Brûlé']);
    mount('/roasters/?state=<script>&q=%3Cimg%3E');
    expect($('#roasterState').value).toBe('');
    expect($('#roasterSearch').value).toBe('<img>');
    expect($('#roasterStatus').textContent).toBe('No roasters match “<img>”.');
    expect($('#roasterStatus').innerHTML).not.toContain('<img>');
  });

  it('submitting the search form does not navigate', () => {
    mount();
    const event = new Event('submit', { bubbles: true, cancelable: true });
    $('#roasterFilters').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('roaster filter: deep-linked search via url-privacy.js', () => {
  it('uses the one-time query handed over by LcsUrlPrivacy', () => {
    window.history.replaceState(null, '', '/roasters/');
    const html = renderRoastersPage(DATA);
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
    window.LcsUrlPrivacy = { takeInitialQuery: () => 'acme' };
    filter.init(document, window);
    expect($('#roasterSearch').value).toBe('acme');
    expect(visibleNames()).toEqual(['Acme Coffee']);
    delete window.LcsUrlPrivacy;
  });
});

describe('roaster analytics', () => {
  let events;
  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    delete window.LcsAnalytics;
  });

  function mountTracked(url) {
    const api = mount(url);
    window.LcsAnalytics = { track: (name, params) => events.push([name, params]) };
    return api;
  }

  it('one debounced roaster_filter per settled filter, with no raw text', () => {
    mountTracked();
    for (const v of ['b', 'be', 'bea', 'bean']) type(v);
    vi.advanceTimersByTime(1500);
    expect(events).toEqual([['roaster_filter', { filter_has_query: 'yes', filter_state: 'all', result_count: 1 }]]);
    type('bean'); // same filter again → not re-counted
    vi.advanceTimersByTime(1500);
    choose('ME');
    vi.advanceTimersByTime(1500);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual(['roaster_filter', { filter_has_query: 'yes', filter_state: 'ME', result_count: 1 }]);
    expect(JSON.stringify(events)).not.toContain('bean');
  });

  it('the initial render is not counted as a filter', () => {
    mountTracked('/roasters/?state=ME');
    vi.advanceTimersByTime(2000);
    expect(events).toEqual([]);
  });

  it('store clicks are NOT a custom event (GA enhanced outbound click is the one canonical metric)', () => {
    mountTracked();
    filter.init(document, window); // re-init must not add anything either
    for (const sel of ['#roaster-bean a.roaster-shop', '#roaster-acme a.roaster-site', '#roaster-bean a.roaster-shop .visually-hidden']) {
      const el = document.querySelector(sel);
      el.addEventListener('click', (e) => e.preventDefault());
      el.click();
    }
    expect(events).toEqual([]);
  });

  it('the stable hooks GA reporting relies on are in the markup: link class roaster-shop and the catalog merchant URL', () => {
    mountTracked();
    const shop = document.querySelector('#roaster-bean a.roaster-shop');
    expect(shop.getAttribute('class')).toBe('roaster-shop');
    expect(shop.getAttribute('href')).toBe('https://bean.test/shop');
  });

  it('source links are not counted as store clicks', () => {
    mountTracked();
    const src = document.querySelector('#roaster-bean .roaster-sources a');
    src.addEventListener('click', (e) => e.preventDefault());
    src.click();
    expect(events).toEqual([]);
  });
});
