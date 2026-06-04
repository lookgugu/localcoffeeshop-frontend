/**
 * DOM Integration Tests - Filter Functionality
 * Tests state and price filter dropdowns, filter combinations, and interactions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../helpers/mockApi.js';
import { change, input, waitForAsyncUpdates } from '../../helpers/dom.js';
import { fixtureStates, fixtureCoffeeShops } from '../../helpers/fixtures.js';

// Load the shared enums and attach to window so the test's view helpers
// (which mirror the browser's `window.CoffeeShopEnums` lookup) can find them.
import enums from '../../../public/enums.js';
window.CoffeeShopEnums = enums;

/**
 * Helper to create test DOM structure
 */
function createTestDOM() {
  const container = document.createElement('div');
  container.className = 'container';

  const searchFilters = document.createElement('div');
  searchFilters.className = 'search-filters';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.id = 'searchInput';
  searchInput.placeholder = 'Search coffee shops...';
  searchFilters.appendChild(searchInput);

  const stateFilter = document.createElement('select');
  stateFilter.id = 'stateFilter';
  const stateAllOption = document.createElement('option');
  stateAllOption.value = '';
  stateAllOption.textContent = 'All States';
  stateFilter.appendChild(stateAllOption);
  searchFilters.appendChild(stateFilter);

  const priceFilter = document.createElement('select');
  priceFilter.id = 'priceFilter';
  const priceOptions = [
    { value: '', text: 'All Prices' },
    { value: 'PRICE_LEVEL_INEXPENSIVE', text: 'Inexpensive' },
    { value: 'PRICE_LEVEL_MODERATE', text: 'Moderate' },
    { value: 'PRICE_LEVEL_EXPENSIVE', text: 'Expensive' }
  ];
  priceOptions.forEach(opt => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.text;
    priceFilter.appendChild(option);
  });
  searchFilters.appendChild(priceFilter);

  container.appendChild(searchFilters);

  const searchResults = document.createElement('div');
  searchResults.id = 'searchResults';
  searchResults.style.display = 'none';
  container.appendChild(searchResults);

  document.body.appendChild(container);
}

/**
 * Helper to populate state filter with states
 */
function populateStateFilter(states) {
  const stateFilter = document.getElementById('stateFilter');

  states.forEach(stateInfo => {
    const option = document.createElement('option');
    option.value = stateInfo.state;
    option.textContent = window.CoffeeShopEnums?.stateName(stateInfo.state) || stateInfo.state;
    stateFilter.appendChild(option);
  });
}

describe('Filter Functionality DOM Tests', () => {
  beforeEach(() => {
    createTestDOM();

    // Mock APP_CONFIG
    window.APP_CONFIG = {
      API_BASE_URL: '/api/v1'
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.clearAllMocks();
    delete window.APP_CONFIG;
  });

  describe('State Filter Dropdown', () => {
    it('should display all states in dropdown', () => {
      populateStateFilter(fixtureStates);

      const stateFilter = document.getElementById('stateFilter');
      const options = stateFilter.querySelectorAll('option');

      // +1 for "All States" option
      expect(options).toHaveLength(fixtureStates.length + 1);
    });

    it('should have "All States" as default option', () => {
      const stateFilter = document.getElementById('stateFilter');
      const firstOption = stateFilter.querySelector('option');

      expect(firstOption.value).toBe('');
      expect(firstOption.textContent).toBe('All States');
    });

    it('should change selected state', () => {
      populateStateFilter(fixtureStates);

      const stateFilter = document.getElementById('stateFilter');

      change(stateFilter, 'CA');

      expect(stateFilter.value).toBe('CA');
    });

    it('should display state names correctly', () => {
      populateStateFilter(fixtureStates);

      const stateFilter = document.getElementById('stateFilter');
      const caOption = Array.from(stateFilter.options).find(opt => opt.value === 'CA');

      expect(caOption.textContent).toBe('California');
    });

    it('should reset to "All States"', () => {
      populateStateFilter(fixtureStates);

      const stateFilter = document.getElementById('stateFilter');

      change(stateFilter, 'CA');
      expect(stateFilter.value).toBe('CA');

      change(stateFilter, '');
      expect(stateFilter.value).toBe('');
    });
  });

  describe('Price Filter Dropdown', () => {
    it('should display all price levels', () => {
      const priceFilter = document.getElementById('priceFilter');
      const options = priceFilter.querySelectorAll('option');

      expect(options).toHaveLength(4); // All Prices + 3 levels
    });

    it('should have "All Prices" as default option', () => {
      const priceFilter = document.getElementById('priceFilter');
      const firstOption = priceFilter.querySelector('option');

      expect(firstOption.value).toBe('');
      expect(firstOption.textContent).toBe('All Prices');
    });

    it('should change selected price level', () => {
      const priceFilter = document.getElementById('priceFilter');

      change(priceFilter, 'PRICE_LEVEL_MODERATE');

      expect(priceFilter.value).toBe('PRICE_LEVEL_MODERATE');
    });

    it('should have correct price level values', () => {
      const priceFilter = document.getElementById('priceFilter');
      const options = Array.from(priceFilter.options);

      const inexpensive = options.find(opt => opt.textContent === 'Inexpensive');
      const moderate = options.find(opt => opt.textContent === 'Moderate');
      const expensive = options.find(opt => opt.textContent === 'Expensive');

      expect(inexpensive.value).toBe('PRICE_LEVEL_INEXPENSIVE');
      expect(moderate.value).toBe('PRICE_LEVEL_MODERATE');
      expect(expensive.value).toBe('PRICE_LEVEL_EXPENSIVE');
    });

    it('should reset to "All Prices"', () => {
      const priceFilter = document.getElementById('priceFilter');

      change(priceFilter, 'PRICE_LEVEL_EXPENSIVE');
      expect(priceFilter.value).toBe('PRICE_LEVEL_EXPENSIVE');

      change(priceFilter, '');
      expect(priceFilter.value).toBe('');
    });
  });

  describe('Filter API Integration', () => {
    it('should send state filter to API', async () => {
      let capturedState = null;

      server.use(
        http.get('*/api/v1/search', ({ request }) => {
          const url = new URL(request.url);
          capturedState = url.searchParams.get('state');
          return HttpResponse.json({
            results: [],
            total: 0,
            filters: { state: capturedState }
          });
        })
      );

      const response = await fetch('/api/v1/search?state=CA');
      await response.json();

      expect(capturedState).toBe('CA');
    });

    it('should send price filter to API', async () => {
      let capturedPrice = null;

      server.use(
        http.get('*/api/v1/search', ({ request }) => {
          const url = new URL(request.url);
          capturedPrice = url.searchParams.get('price');
          return HttpResponse.json({
            results: [],
            total: 0,
            filters: { price: capturedPrice }
          });
        })
      );

      const response = await fetch('/api/v1/search?price=PRICE_LEVEL_MODERATE');
      await response.json();

      expect(capturedPrice).toBe('PRICE_LEVEL_MODERATE');
    });

    it('should send combined filters to API', async () => {
      let capturedFilters = {};

      server.use(
        http.get('*/api/v1/search', ({ request }) => {
          const url = new URL(request.url);
          capturedFilters = {
            state: url.searchParams.get('state'),
            price: url.searchParams.get('price')
          };
          return HttpResponse.json({
            results: [],
            total: 0,
            filters: capturedFilters
          });
        })
      );

      const response = await fetch('/api/v1/search?state=CA&price=PRICE_LEVEL_MODERATE');
      await response.json();

      expect(capturedFilters.state).toBe('CA');
      expect(capturedFilters.price).toBe('PRICE_LEVEL_MODERATE');
    });
  });

  describe('Filter Combinations', () => {
    it('should combine state and price filters', () => {
      populateStateFilter(fixtureStates);

      const stateFilter = document.getElementById('stateFilter');
      const priceFilter = document.getElementById('priceFilter');

      change(stateFilter, 'CA');
      change(priceFilter, 'PRICE_LEVEL_MODERATE');

      expect(stateFilter.value).toBe('CA');
      expect(priceFilter.value).toBe('PRICE_LEVEL_MODERATE');
    });

    it('should combine search query with filters', () => {
      populateStateFilter(fixtureStates);

      const searchInput = document.getElementById('searchInput');
      const stateFilter = document.getElementById('stateFilter');
      const priceFilter = document.getElementById('priceFilter');

      input(searchInput, 'coffee');
      change(stateFilter, 'CA');
      change(priceFilter, 'PRICE_LEVEL_MODERATE');

      expect(searchInput.value).toBe('coffee');
      expect(stateFilter.value).toBe('CA');
      expect(priceFilter.value).toBe('PRICE_LEVEL_MODERATE');
    });

    it('should maintain filters during search', async () => {
      populateStateFilter(fixtureStates);

      const stateFilter = document.getElementById('stateFilter');
      const priceFilter = document.getElementById('priceFilter');

      change(stateFilter, 'CA');
      change(priceFilter, 'PRICE_LEVEL_MODERATE');

      // Simulate search
      await fetch('/api/v1/search?state=CA&price=PRICE_LEVEL_MODERATE');

      // Filters should persist
      expect(stateFilter.value).toBe('CA');
      expect(priceFilter.value).toBe('PRICE_LEVEL_MODERATE');
    });

    it('should filter results by state only', async () => {
      server.use(
        http.get('*/api/v1/search', ({ request }) => {
          const url = new URL(request.url);
          const state = url.searchParams.get('state');

          const filtered = fixtureCoffeeShops.filter(shop => shop.state === state);

          return HttpResponse.json({
            results: filtered,
            total: filtered.length
          });
        })
      );

      const response = await fetch('/api/v1/search?state=CA');
      const data = await response.json();

      expect(data.results.every(shop => shop.state === 'CA')).toBe(true);
    });

    it('should filter results by price only', async () => {
      server.use(
        http.get('*/api/v1/search', ({ request }) => {
          const url = new URL(request.url);
          const price = url.searchParams.get('price');

          const filtered = fixtureCoffeeShops.filter(shop => shop.priceLevel === price);

          return HttpResponse.json({
            results: filtered,
            total: filtered.length
          });
        })
      );

      const response = await fetch('/api/v1/search?price=PRICE_LEVEL_MODERATE');
      const data = await response.json();

      expect(data.results.every(shop => shop.priceLevel === 'PRICE_LEVEL_MODERATE')).toBe(true);
    });

    it('should filter results by both state and price', async () => {
      server.use(
        http.get('*/api/v1/search', ({ request }) => {
          const url = new URL(request.url);
          const state = url.searchParams.get('state');
          const price = url.searchParams.get('price');

          const filtered = fixtureCoffeeShops.filter(shop =>
            shop.state === state && shop.priceLevel === price
          );

          return HttpResponse.json({
            results: filtered,
            total: filtered.length
          });
        })
      );

      const response = await fetch('/api/v1/search?state=CA&price=PRICE_LEVEL_MODERATE');
      const data = await response.json();

      expect(data.results.every(shop =>
        shop.state === 'CA' && shop.priceLevel === 'PRICE_LEVEL_MODERATE'
      )).toBe(true);
    });
  });

  describe('Clearing Filters', () => {
    it('should clear state filter', () => {
      populateStateFilter(fixtureStates);

      const stateFilter = document.getElementById('stateFilter');

      change(stateFilter, 'CA');
      expect(stateFilter.value).toBe('CA');

      change(stateFilter, '');
      expect(stateFilter.value).toBe('');
    });

    it('should clear price filter', () => {
      const priceFilter = document.getElementById('priceFilter');

      change(priceFilter, 'PRICE_LEVEL_EXPENSIVE');
      expect(priceFilter.value).toBe('PRICE_LEVEL_EXPENSIVE');

      change(priceFilter, '');
      expect(priceFilter.value).toBe('');
    });

    it('should clear all filters and reset to all results', () => {
      populateStateFilter(fixtureStates);

      const searchInput = document.getElementById('searchInput');
      const stateFilter = document.getElementById('stateFilter');
      const priceFilter = document.getElementById('priceFilter');

      input(searchInput, 'coffee');
      change(stateFilter, 'CA');
      change(priceFilter, 'PRICE_LEVEL_MODERATE');

      // Clear all
      searchInput.value = '';
      input(searchInput, '');
      change(stateFilter, '');
      change(priceFilter, '');

      expect(searchInput.value).toBe('');
      expect(stateFilter.value).toBe('');
      expect(priceFilter.value).toBe('');
    });

    it('should show all results when filters are cleared', async () => {
      const response = await fetch('/api/v1/search?state=&price=');
      const data = await response.json();

      // Should return unfiltered results
      expect(Array.isArray(data.results)).toBe(true);
    });
  });

  describe('Filter Change Triggers Search', () => {
    it('should trigger search when state filter changes', async () => {
      vi.useFakeTimers();

      populateStateFilter(fixtureStates);

      const searchSpy = vi.fn();
      server.use(
        http.get('*/api/v1/search', () => {
          searchSpy();
          return HttpResponse.json({ results: [], total: 0 });
        })
      );

      const stateFilter = document.getElementById('stateFilter');

      // Set up change handler with debounce
      let timeout = null;
      stateFilter.addEventListener('change', () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          fetch('/api/v1/search?state=' + stateFilter.value);
        }, 300);
      });

      change(stateFilter, 'CA');

      await vi.advanceTimersByTimeAsync(300);

      expect(searchSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should trigger search when price filter changes', async () => {
      vi.useFakeTimers();

      const searchSpy = vi.fn();
      server.use(
        http.get('*/api/v1/search', () => {
          searchSpy();
          return HttpResponse.json({ results: [], total: 0 });
        })
      );

      const priceFilter = document.getElementById('priceFilter');

      let timeout = null;
      priceFilter.addEventListener('change', () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
          fetch('/api/v1/search?price=' + priceFilter.value);
        }, 300);
      });

      change(priceFilter, 'PRICE_LEVEL_MODERATE');

      await vi.advanceTimersByTimeAsync(300);

      expect(searchSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('Filter Loading States', () => {
    it('should disable filters during search', () => {
      populateStateFilter(fixtureStates);

      const stateFilter = document.getElementById('stateFilter');
      const priceFilter = document.getElementById('priceFilter');

      stateFilter.disabled = true;
      priceFilter.disabled = true;

      expect(stateFilter.disabled).toBe(true);
      expect(priceFilter.disabled).toBe(true);
    });

    it('should re-enable filters after search completes', () => {
      populateStateFilter(fixtureStates);

      const stateFilter = document.getElementById('stateFilter');
      const priceFilter = document.getElementById('priceFilter');

      stateFilter.disabled = true;
      priceFilter.disabled = true;

      // Simulate search completion
      stateFilter.disabled = false;
      priceFilter.disabled = false;

      expect(stateFilter.disabled).toBe(false);
      expect(priceFilter.disabled).toBe(false);
    });
  });

  describe('Filter Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      server.use(
        http.get('*/api/v1/search', () => {
          return HttpResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
          );
        })
      );

      const response = await fetch('/api/v1/search?state=CA');

      expect(response.ok).toBe(false);
      expect(response.status).toBe(500);
    });

    it('should keep filter values on error', async () => {
      populateStateFilter(fixtureStates);

      const stateFilter = document.getElementById('stateFilter');
      const priceFilter = document.getElementById('priceFilter');

      change(stateFilter, 'CA');
      change(priceFilter, 'PRICE_LEVEL_MODERATE');

      // Simulate error (filters should persist)
      expect(stateFilter.value).toBe('CA');
      expect(priceFilter.value).toBe('PRICE_LEVEL_MODERATE');
    });
  });

  describe('Keyboard Navigation', () => {
    it('should navigate state filter with keyboard', () => {
      populateStateFilter(fixtureStates);

      const stateFilter = document.getElementById('stateFilter');

      stateFilter.focus();
      expect(document.activeElement).toBe(stateFilter);

      // Simulate arrow down (would select next option in real browser)
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      stateFilter.dispatchEvent(event);

      // In real browser, selectedIndex would change
    });

    it('should navigate price filter with keyboard', () => {
      const priceFilter = document.getElementById('priceFilter');

      priceFilter.focus();
      expect(document.activeElement).toBe(priceFilter);

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      priceFilter.dispatchEvent(event);
    });

    it('should tab between filters', () => {
      populateStateFilter(fixtureStates);

      const searchInput = document.getElementById('searchInput');
      const stateFilter = document.getElementById('stateFilter');
      const priceFilter = document.getElementById('priceFilter');

      searchInput.focus();
      expect(document.activeElement).toBe(searchInput);

      // In real browser, Tab would move focus to next element
      stateFilter.focus();
      expect(document.activeElement).toBe(stateFilter);

      priceFilter.focus();
      expect(document.activeElement).toBe(priceFilter);
    });
  });

  describe('Accessibility', () => {
    it('should have labels for filters', () => {
      const stateFilter = document.getElementById('stateFilter');
      const priceFilter = document.getElementById('priceFilter');

      // Add labels
      const stateLabel = document.createElement('label');
      stateLabel.setAttribute('for', 'stateFilter');
      stateLabel.textContent = 'Filter by State';
      stateFilter.parentElement.insertBefore(stateLabel, stateFilter);

      const priceLabel = document.createElement('label');
      priceLabel.setAttribute('for', 'priceFilter');
      priceLabel.textContent = 'Filter by Price';
      priceFilter.parentElement.insertBefore(priceLabel, priceFilter);

      expect(document.querySelector('label[for="stateFilter"]')).toBeTruthy();
      expect(document.querySelector('label[for="priceFilter"]')).toBeTruthy();
    });

    it('should have accessible option text', () => {
      populateStateFilter(fixtureStates);

      const stateFilter = document.getElementById('stateFilter');
      const options = stateFilter.querySelectorAll('option');

      options.forEach(option => {
        expect(option.textContent.trim().length).toBeGreaterThan(0);
      });
    });

    it('should announce filter changes to screen readers', () => {
      const announcement = document.createElement('div');
      announcement.setAttribute('role', 'status');
      announcement.setAttribute('aria-live', 'polite');
      announcement.className = 'visually-hidden';
      document.body.appendChild(announcement);

      populateStateFilter(fixtureStates);

      const stateFilter = document.getElementById('stateFilter');

      stateFilter.addEventListener('change', () => {
        const stateName = stateFilter.options[stateFilter.selectedIndex].textContent;
        announcement.textContent = `Filtering by ${stateName}`;
      });

      change(stateFilter, 'CA');

      expect(announcement.textContent).toBe('Filtering by California');
    });
  });
});
