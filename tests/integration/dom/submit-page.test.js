/**
 * Integration Tests — submit page (`public/submit.js`)
 *
 * Targeted at the non-array `statesData` guard. A previous `(statesData || [])`
 * pattern would crash on a truthy non-array (e.g. `{}`); the new guard uses
 * `Array.isArray` so the call quietly no-ops on an unexpected response shape.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../helpers/mockApi.js';

import enums from '../../../public/enums.js';
import api from '../../../public/api-client.js';

function mountDom() {
  // submit.js queries these on DOMContentLoaded. We only need the elements to
  // exist; the test cares about whether loadAllCoffeeShops crashes.
  const shopState = document.createElement('select');
  shopState.id = 'shop-state';
  const updateState = document.createElement('select');
  updateState.id = 'update-state';
  document.body.appendChild(shopState);
  document.body.appendChild(updateState);
}

describe('submit.js — non-array /states response', () => {
  beforeEach(() => {
    mountDom();
    window.CoffeeShopEnums = enums;
    window.ApiClient = api;
  });

  afterEach(() => {
    delete window.CoffeeShopEnums;
    delete window.ApiClient;
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    vi.resetModules();
  });

  it('does not throw when /states returns an empty object instead of an array', async () => {
    server.use(
      http.get('*/api/v1/states', () => {
        return HttpResponse.json({ success: true, data: {} });
      })
    );

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.resetModules();
    await import('../../../public/submit.js');

    // The script's loadAllCoffeeShops fires on DOMContentLoaded; wait a tick.
    await new Promise((r) => setTimeout(r, 50));

    // Crucially, the script's own try/catch would have logged any forEach
    // TypeError. Assert nothing was logged → the Array.isArray guard held.
    const crashLogged = errSpy.mock.calls.some(([msg]) =>
      typeof msg === 'string' && msg.includes('Error loading coffee shops')
    );
    expect(crashLogged).toBe(false);
    errSpy.mockRestore();
  });
});
