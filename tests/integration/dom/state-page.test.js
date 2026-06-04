/**
 * Integration Tests — state page (`public/html/state.js`)
 *
 * Targeted at the data-validation guard that we just rewrote:
 *   - If the API returns a non-array body, the page must NOT try to render it.
 *
 * The page module is a side-effect script that pulls deps off `window`, so we
 * wire those up before importing it. We rely on `vi.isolateModulesAsync` to
 * re-execute the script per test (it caches module-level state otherwise).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../helpers/mockApi.js';

import enums from '../../../public/enums.js';
import skeleton from '../../../public/skeleton.js';
import storeMod from '../../../public/store.js';
import api from '../../../public/api-client.js';

function mountDom() {
  // Build the minimal DOM scaffold the page expects.
  for (const [tag, id] of [
    ['h1', 'pageTitle'],
    ['span', 'totalShops'],
    ['span', 'avgPrice'],
    ['ul', 'coffeeList'],
    ['meta', 'metaDescription'],
    ['meta', 'metaOgTitle'],
    ['meta', 'metaOgDescription'],
    ['link', 'canonicalLink'],
  ]) {
    const el = document.createElement(tag);
    el.id = id;
    document.body.appendChild(el);
  }
}

function stubWindowDeps() {
  window.CoffeeShopEnums = enums;
  window.CoffeeShopSkeleton = skeleton;
  window.CoffeeShopStore = storeMod;
  window.ApiClient = api;
}

describe('state.js — invalid API response shape', () => {
  beforeEach(() => {
    mountDom();
    stubWindowDeps();
    // Pretend we're on /html/state.html?code=CA so the page actually fetches.
    Object.defineProperty(window, 'location', {
      value: new URL('http://localhost/html/state.html?code=CA'),
      writable: true,
    });
  });

  afterEach(() => {
    delete window.CoffeeShopEnums;
    delete window.CoffeeShopSkeleton;
    delete window.CoffeeShopStore;
    delete window.ApiClient;
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    vi.resetModules();
  });

  it('renders the error message when /states/:code returns a non-array body', async () => {
    // Wrap the non-array in the success envelope — ApiClient unwraps to `data`,
    // which is the (invalid) `{ unexpected: true }` payload state.js must reject.
    server.use(
      http.get('*/api/v1/config', () => HttpResponse.json({ success: true, data: { frontend_url: 'http://localhost' } })),
      http.get('*/api/v1/states/CA', () => {
        return HttpResponse.json({ success: true, data: { unexpected: true } });
      })
    );

    // Suppress the page's console.error noise — the validation throw is logged
    // by the catch block in loadStateShops.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.resetModules();
    await import('../../../public/html/state.js');

    // The page wires its DOMContentLoaded listener inside import; dispatch it.
    document.dispatchEvent(new Event('DOMContentLoaded'));

    // The page boots, fetches, fails the Array.isArray guard, and renders error.
    await new Promise((r) => setTimeout(r, 100));

    const coffeeList = document.getElementById('coffeeList');
    expect(coffeeList.textContent).toMatch(/error/i);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
