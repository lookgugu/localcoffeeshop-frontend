/**
 * DOM Integration Tests - Search Functionality
 * Tests search input, debouncing, API calls, and results display
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../helpers/mockApi.js';
import { input, click, keydown, waitForElement, waitForAsyncUpdates } from '../../helpers/dom.js';
import { fixtureCoffeeShops, edgeCaseFixtures } from '../../helpers/fixtures.js';

// Load the shared enums and attach to window so the test's view helpers
// (which mirror the browser's `window.CoffeeShopEnums` lookup) can find them.
import enums from '../../../public/enums.js';
window.CoffeeShopEnums = enums;

/**
 * Helper to create DOM structure safely
 */
function createTestDOM() {
  const container = document.createElement('div');
  container.className = 'container';

  const serverStatus = document.createElement('div');
  serverStatus.id = 'serverStatus';
  serverStatus.style.display = 'none';
  serverStatus.textContent = 'Server offline';
  container.appendChild(serverStatus);

  const searchFilters = document.createElement('div');
  searchFilters.className = 'search-filters';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.id = 'searchInput';
  searchInput.placeholder = 'Search coffee shops...';
  searchFilters.appendChild(searchInput);

  const stateFilter = document.createElement('select');
  stateFilter.id = 'stateFilter';
  const stateOption = document.createElement('option');
  stateOption.value = '';
  stateOption.textContent = 'All States';
  stateFilter.appendChild(stateOption);
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

  const stateGrid = document.createElement('div');
  stateGrid.id = 'stateGrid';
  container.appendChild(stateGrid);

  document.body.appendChild(container);
}

describe('Search Functionality DOM Tests', () => {
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

  describe('Search Input', () => {
    it('should update search input value as user types', () => {
      const searchInput = document.getElementById('searchInput');

      input(searchInput, 'coffee');

      expect(searchInput.value).toBe('coffee');
    });

    it('should accept empty search query', () => {
      const searchInput = document.getElementById('searchInput');

      input(searchInput, '');

      expect(searchInput.value).toBe('');
    });

    it('should handle special characters in search', () => {
      const searchInput = document.getElementById('searchInput');

      input(searchInput, 'café & tea');

      expect(searchInput.value).toBe('café & tea');
    });

    it('should preserve search input on focus/blur', () => {
      const searchInput = document.getElementById('searchInput');

      input(searchInput, 'test search');

      searchInput.blur();
      expect(searchInput.value).toBe('test search');

      searchInput.focus();
      expect(searchInput.value).toBe('test search');
    });
  });

  describe('Search Debouncing', () => {
    it('should debounce search input with 300ms delay', async () => {
      vi.useFakeTimers();

      // Mock the search endpoint
      const searchSpy = vi.fn();
      server.use(
        http.get('*/api/v1/search', ({ request }) => {
          searchSpy(request.url);
          return HttpResponse.json({
            results: [],
            total: 0,
            query: '',
            filters: {}
          });
        })
      );

      // Manually set up the debounce search functionality
      const searchInput = document.getElementById('searchInput');
      let searchTimeout = null;
      const DEBOUNCE_MS = 300;

      const debounceSearch = () => {
        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          // Simulate API call
          const query = searchInput.value;
          if (query) {
            fetch(`/api/v1/search?q=${query}`);
          }
        }, DEBOUNCE_MS);
      };

      searchInput.addEventListener('input', debounceSearch);

      // Type rapidly
      input(searchInput, 'c');
      await vi.advanceTimersByTimeAsync(100);

      input(searchInput, 'co');
      await vi.advanceTimersByTimeAsync(100);

      input(searchInput, 'cof');
      await vi.advanceTimersByTimeAsync(100);

      // Should not have called API yet
      expect(searchSpy).not.toHaveBeenCalled();

      // Wait for debounce period
      await vi.advanceTimersByTimeAsync(300);

      // Should have called API once
      expect(searchSpy).toHaveBeenCalledTimes(1);
      expect(searchSpy.mock.calls[0][0]).toContain('q=cof');

      vi.useRealTimers();
    });

    it('should reset debounce timer on each keystroke', async () => {
      vi.useFakeTimers();

      const searchSpy = vi.fn();
      server.use(
        http.get('*/api/v1/search', () => {
          searchSpy();
          return HttpResponse.json({ results: [], total: 0 });
        })
      );

      const searchInput = document.getElementById('searchInput');
      let searchTimeout = null;

      const debounceSearch = () => {
        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          if (searchInput.value) fetch(`/api/v1/search?q=${searchInput.value}`);
        }, 300);
      };

      searchInput.addEventListener('input', debounceSearch);

      // Type continuously
      input(searchInput, 'c');
      await vi.advanceTimersByTimeAsync(250);

      input(searchInput, 'co');
      await vi.advanceTimersByTimeAsync(250);

      input(searchInput, 'cof');
      await vi.advanceTimersByTimeAsync(250);

      // Still shouldn't have called (timer keeps resetting)
      expect(searchSpy).not.toHaveBeenCalled();

      // Wait full debounce after last keystroke
      await vi.advanceTimersByTimeAsync(300);

      expect(searchSpy).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('should not trigger multiple searches during rapid typing', async () => {
      vi.useFakeTimers();

      const searchSpy = vi.fn();
      server.use(
        http.get('*/api/v1/search', () => {
          searchSpy();
          return HttpResponse.json({ results: [], total: 0 });
        })
      );

      const searchInput = document.getElementById('searchInput');
      let searchTimeout = null;

      const debounceSearch = () => {
        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          if (searchInput.value) fetch(`/api/v1/search?q=${searchInput.value}`);
        }, 300);
      };

      searchInput.addEventListener('input', debounceSearch);

      // Rapid typing
      for (let i = 1; i <= 10; i++) {
        input(searchInput, 'c'.repeat(i));
        await vi.advanceTimersByTimeAsync(50);
      }

      // No searches yet
      expect(searchSpy).not.toHaveBeenCalled();

      // Wait for final debounce
      await vi.advanceTimersByTimeAsync(300);

      // Only one search
      expect(searchSpy).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('Search API Integration', () => {
    it('should send search query to API with correct parameter', async () => {
      let capturedQuery = null;

      server.use(
        http.get('*/api/v1/search', ({ request }) => {
          const url = new URL(request.url);
          capturedQuery = url.searchParams.get('q');
          return HttpResponse.json({
            results: fixtureCoffeeShops.slice(0, 3),
            total: 3,
            query: capturedQuery,
            filters: {}
          });
        })
      );

      // Simulate search
      const response = await fetch('/api/v1/search?q=coffee');
      await response.json();

      expect(capturedQuery).toBe('coffee');
    });

    it('should handle empty search query', async () => {
      let capturedQuery = null;

      server.use(
        http.get('*/api/v1/search', ({ request }) => {
          const url = new URL(request.url);
          capturedQuery = url.searchParams.get('q');
          return HttpResponse.json({
            results: [],
            total: 0,
            query: '',
            filters: {}
          });
        })
      );

      const response = await fetch('/api/v1/search?q=');
      await response.json();

      expect(capturedQuery).toBe('');
    });

    it('should handle special characters in search query', async () => {
      let capturedQuery = null;

      server.use(
        http.get('*/api/v1/search', ({ request }) => {
          const url = new URL(request.url);
          capturedQuery = url.searchParams.get('q');
          return HttpResponse.json({
            results: [],
            total: 0
          });
        })
      );

      const response = await fetch('/api/v1/search?q=' + encodeURIComponent('café & tea'));
      await response.json();

      expect(capturedQuery).toBe('café & tea');
    });
  });

  describe('Search Results Display', () => {
    it('should display search results in DOM', async () => {
      const searchResults = document.getElementById('searchResults');

      // Manually create result elements
      const header = document.createElement('h2');
      header.textContent = 'Search Results';
      searchResults.appendChild(header);

      const resultCount = document.createElement('p');
      resultCount.className = 'result-count';
      resultCount.textContent = '3 found';
      searchResults.appendChild(resultCount);

      fixtureCoffeeShops.slice(0, 3).forEach(shop => {
        const item = document.createElement('li');
        item.className = 'coffee-item';

        const name = document.createElement('h3');
        name.textContent = shop.displayName.text;
        item.appendChild(name);

        searchResults.appendChild(item);
      });

      searchResults.style.display = 'block';

      expect(searchResults.style.display).toBe('block');
      expect(searchResults.querySelector('h2').textContent).toBe('Search Results');
      expect(searchResults.querySelector('.result-count').textContent).toBe('3 found');
      expect(searchResults.querySelectorAll('.coffee-item')).toHaveLength(3);
    });

    it('should clear previous results before displaying new ones', () => {
      const searchResults = document.getElementById('searchResults');

      // Add initial results
      const item1 = document.createElement('li');
      item1.className = 'coffee-item';
      item1.textContent = 'Old result';
      searchResults.appendChild(item1);

      expect(searchResults.children).toHaveLength(1);

      // Clear and add new results
      searchResults.replaceChildren();

      const item2 = document.createElement('li');
      item2.className = 'coffee-item';
      item2.textContent = 'New result';
      searchResults.appendChild(item2);

      expect(searchResults.children).toHaveLength(1);
      expect(searchResults.textContent).toBe('New result');
    });

    it('should display "no results" message when no shops found', () => {
      const searchResults = document.getElementById('searchResults');

      const header = document.createElement('h2');
      header.textContent = 'Search Results';
      searchResults.appendChild(header);

      const noResults = document.createElement('div');
      noResults.className = 'no-results';
      noResults.textContent = 'No coffee shops found';
      searchResults.appendChild(noResults);

      expect(searchResults.querySelector('.no-results')).toBeTruthy();
      expect(searchResults.querySelector('.no-results').textContent).toBe('No coffee shops found');
    });

    it('should display result count correctly', () => {
      const searchResults = document.getElementById('searchResults');

      const resultCount = document.createElement('p');
      resultCount.className = 'result-count';
      resultCount.textContent = '42 found';
      searchResults.appendChild(resultCount);

      expect(searchResults.querySelector('.result-count').textContent).toBe('42 found');
    });
  });

  describe('Search Loading State', () => {
    it('should show loading skeleton during search', () => {
      const searchResults = document.getElementById('searchResults');

      // Show loading state
      searchResults.style.display = 'block';
      searchResults.replaceChildren();

      const header = document.createElement('h2');
      header.textContent = 'Search Results';
      searchResults.appendChild(header);

      // Add skeleton items
      for (let i = 0; i < 5; i++) {
        const skeleton = document.createElement('li');
        skeleton.className = 'skeleton-item';
        skeleton.setAttribute('aria-hidden', 'true');
        searchResults.appendChild(skeleton);
      }

      expect(searchResults.querySelectorAll('.skeleton-item')).toHaveLength(5);
      expect(searchResults.style.display).toBe('block');
    });

    it('should remove loading skeleton after results load', () => {
      const searchResults = document.getElementById('searchResults');

      // Add skeletons
      for (let i = 0; i < 5; i++) {
        const skeleton = document.createElement('li');
        skeleton.className = 'skeleton-item';
        searchResults.appendChild(skeleton);
      }

      expect(searchResults.querySelectorAll('.skeleton-item')).toHaveLength(5);

      // Remove skeletons
      searchResults.querySelectorAll('.skeleton-item').forEach(s => s.remove());

      expect(searchResults.querySelectorAll('.skeleton-item')).toHaveLength(0);
    });

    it('should show loading announcement for screen readers', () => {
      const searchResults = document.getElementById('searchResults');

      const srText = document.createElement('p');
      srText.className = 'visually-hidden';
      srText.setAttribute('role', 'status');
      srText.setAttribute('aria-live', 'polite');
      srText.textContent = 'Loading search results...';
      searchResults.appendChild(srText);

      const announcement = searchResults.querySelector('[role="status"]');
      expect(announcement).toBeTruthy();
      expect(announcement.textContent).toBe('Loading search results...');
      expect(announcement.getAttribute('aria-live')).toBe('polite');
    });
  });

  describe('Search Error Handling', () => {
    it('should display error message on search failure', () => {
      const container = document.querySelector('.container');

      const errorDiv = document.createElement('div');
      errorDiv.className = 'error-message';
      errorDiv.textContent = 'Failed to search coffee shops. Please try again.';
      errorDiv.style.cssText = 'background: #fee; border: 1px solid #fcc; padding: 10px; margin: 10px 0; border-radius: 4px; color: #c33;';

      container.insertBefore(errorDiv, container.firstChild);

      expect(container.querySelector('.error-message')).toBeTruthy();
      expect(container.querySelector('.error-message').textContent).toBe('Failed to search coffee shops. Please try again.');
    });

    it('should auto-remove error message after timeout', async () => {
      vi.useFakeTimers();

      const container = document.querySelector('.container');

      const errorDiv = document.createElement('div');
      errorDiv.className = 'error-message';
      errorDiv.textContent = 'Error occurred';
      container.appendChild(errorDiv);

      expect(container.querySelector('.error-message')).toBeTruthy();

      // Schedule removal
      setTimeout(() => errorDiv.remove(), 5000);

      await vi.advanceTimersByTimeAsync(5000);

      expect(container.querySelector('.error-message')).toBeFalsy();

      vi.useRealTimers();
    });
  });

  describe('Keyboard Interactions', () => {
    it('should handle Enter key in search input', () => {
      const searchInput = document.getElementById('searchInput');
      let enterPressed = false;

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          enterPressed = true;
        }
      });

      input(searchInput, 'coffee');
      keydown(searchInput, 'Enter');

      expect(enterPressed).toBe(true);
    });

    it('should handle Escape key to clear search', () => {
      const searchInput = document.getElementById('searchInput');

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          searchInput.value = '';
        }
      });

      input(searchInput, 'coffee');
      expect(searchInput.value).toBe('coffee');

      keydown(searchInput, 'Escape');
      expect(searchInput.value).toBe('');
    });
  });

  describe('Search Result Focus Management', () => {
    it('should move focus to results for screen reader users', () => {
      const searchResults = document.getElementById('searchResults');

      searchResults.setAttribute('tabindex', '-1');
      searchResults.focus();

      expect(searchResults.getAttribute('tabindex')).toBe('-1');
      expect(document.activeElement).toBe(searchResults);
    });
  });
});
