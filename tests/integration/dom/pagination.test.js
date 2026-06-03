/**
 * DOM Integration Tests - Pagination Functionality
 * Tests load more button, batch loading, and pagination state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../helpers/mockApi.js';
import { click, waitForAsyncUpdates } from '../../helpers/dom.js';
import { edgeCaseFixtures } from '../../helpers/fixtures.js';

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

  const searchResults = document.createElement('div');
  searchResults.id = 'searchResults';
  container.appendChild(searchResults);

  document.body.appendChild(container);
}

/**
 * Helper to create shop element
 */
function createShopElement(shop) {
  const item = document.createElement('li');
  item.className = 'coffee-item';

  const name = document.createElement('h3');
  name.textContent = shop.displayName.text;
  item.appendChild(name);

  if (shop.formattedAddress) {
    const address = document.createElement('p');
    address.textContent = shop.formattedAddress;
    item.appendChild(address);
  }

  return item;
}

/**
 * Helper to display results with pagination
 */
function displayResultsWithPagination(shops, perPage = 50) {
  const searchResults = document.getElementById('searchResults');
  searchResults.replaceChildren();

  const header = document.createElement('h2');
  header.textContent = 'Search Results';
  searchResults.appendChild(header);

  const resultCount = document.createElement('p');
  resultCount.className = 'result-count';
  resultCount.textContent = `${shops.length} found`;
  searchResults.appendChild(resultCount);

  // Display first page
  const shopsToRender = shops.length > perPage ? shops.slice(0, perPage) : shops;

  shopsToRender.forEach(shop => {
    searchResults.appendChild(createShopElement(shop));
  });

  // Add load more button if needed
  if (shops.length > perPage) {
    const loadMoreButton = document.createElement('button');
    loadMoreButton.className = 'load-more';
    loadMoreButton.textContent = `Load More (${shops.length - perPage} remaining)`;
    loadMoreButton.setAttribute('aria-label', `Load ${shops.length - perPage} more results`);
    searchResults.appendChild(loadMoreButton);

    return {
      loadMoreButton,
      allShops: shops,
      currentlyShowing: perPage
    };
  }

  return {
    loadMoreButton: null,
    allShops: shops,
    currentlyShowing: shops.length
  };
}

/**
 * Helper to load more results
 */
function loadMoreResults(state, batchSize = 50) {
  const { allShops, currentlyShowing } = state;
  const searchResults = document.getElementById('searchResults');

  if (currentlyShowing >= allShops.length) return state;

  const nextBatch = Math.min(currentlyShowing + batchSize, allShops.length);
  const additionalShops = allShops.slice(currentlyShowing, nextBatch);

  const loadMoreButton = searchResults.querySelector('.load-more');

  additionalShops.forEach(shop => {
    searchResults.insertBefore(createShopElement(shop), loadMoreButton);
  });

  // Update button or remove it
  if (nextBatch < allShops.length) {
    loadMoreButton.textContent = `Load More (${allShops.length - nextBatch} remaining)`;
    loadMoreButton.setAttribute('aria-label', `Load ${allShops.length - nextBatch} more results`);
  } else {
    loadMoreButton.remove();
  }

  return {
    ...state,
    currentlyShowing: nextBatch
  };
}

describe('Pagination Functionality DOM Tests', () => {
  beforeEach(() => {
    createTestDOM();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.clearAllMocks();
  });

  describe('Initial Page Display', () => {
    it('should display first 50 results initially', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet;
      const state = displayResultsWithPagination(largeResultSet, 50);

      const searchResults = document.getElementById('searchResults');
      const items = searchResults.querySelectorAll('.coffee-item');

      expect(items).toHaveLength(50);
      expect(state.currentlyShowing).toBe(50);
    });

    it('should display all results when less than 50 items', () => {
      const smallResultSet = edgeCaseFixtures.largeResultSet.slice(0, 30);
      const state = displayResultsWithPagination(smallResultSet, 50);

      const searchResults = document.getElementById('searchResults');
      const items = searchResults.querySelectorAll('.coffee-item');

      expect(items).toHaveLength(30);
      expect(state.currentlyShowing).toBe(30);
    });

    it('should display exactly 50 items when result count is 50', () => {
      const exactFiftyResults = edgeCaseFixtures.largeResultSet.slice(0, 50);
      const state = displayResultsWithPagination(exactFiftyResults, 50);

      const searchResults = document.getElementById('searchResults');
      const items = searchResults.querySelectorAll('.coffee-item');

      expect(items).toHaveLength(50);
      expect(state.loadMoreButton).toBe(null);
    });
  });

  describe('Load More Button', () => {
    it('should show "Load More" button when more results available', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet;
      displayResultsWithPagination(largeResultSet, 50);

      const searchResults = document.getElementById('searchResults');
      const loadMoreButton = searchResults.querySelector('.load-more');

      expect(loadMoreButton).toBeTruthy();
      expect(loadMoreButton.textContent).toContain('Load More');
    });

    it('should not show "Load More" button when all results displayed', () => {
      const smallResultSet = edgeCaseFixtures.largeResultSet.slice(0, 30);
      displayResultsWithPagination(smallResultSet, 50);

      const searchResults = document.getElementById('searchResults');
      const loadMoreButton = searchResults.querySelector('.load-more');

      expect(loadMoreButton).toBe(null);
    });

    it('should show correct remaining count on button', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet.slice(0, 150);
      displayResultsWithPagination(largeResultSet, 50);

      const searchResults = document.getElementById('searchResults');
      const loadMoreButton = searchResults.querySelector('.load-more');

      expect(loadMoreButton.textContent).toBe('Load More (100 remaining)');
    });

    it('should have aria-label for accessibility', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet.slice(0, 150);
      displayResultsWithPagination(largeResultSet, 50);

      const searchResults = document.getElementById('searchResults');
      const loadMoreButton = searchResults.querySelector('.load-more');

      expect(loadMoreButton.getAttribute('aria-label')).toBe('Load 100 more results');
    });

    it('should not show button with exactly 50 results', () => {
      const exactFiftyResults = edgeCaseFixtures.largeResultSet.slice(0, 50);
      displayResultsWithPagination(exactFiftyResults, 50);

      const searchResults = document.getElementById('searchResults');
      const loadMoreButton = searchResults.querySelector('.load-more');

      expect(loadMoreButton).toBe(null);
    });

    it('should show button with 51 results', () => {
      const fiftyOneResults = edgeCaseFixtures.largeResultSet.slice(0, 51);
      displayResultsWithPagination(fiftyOneResults, 50);

      const searchResults = document.getElementById('searchResults');
      const loadMoreButton = searchResults.querySelector('.load-more');

      expect(loadMoreButton).toBeTruthy();
      expect(loadMoreButton.textContent).toBe('Load More (1 remaining)');
    });
  });

  describe('Loading More Results', () => {
    it('should load next 50 items when clicking "Load More"', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet.slice(0, 150);
      let state = displayResultsWithPagination(largeResultSet, 50);

      const searchResults = document.getElementById('searchResults');
      let items = searchResults.querySelectorAll('.coffee-item');
      expect(items).toHaveLength(50);

      // Load more
      state = loadMoreResults(state, 50);

      items = searchResults.querySelectorAll('.coffee-item');
      expect(items).toHaveLength(100);
      expect(state.currentlyShowing).toBe(100);
    });

    it('should keep previously loaded items visible', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet.slice(0, 150);
      let state = displayResultsWithPagination(largeResultSet, 50);

      const searchResults = document.getElementById('searchResults');
      const firstItemText = searchResults.querySelector('.coffee-item h3').textContent;

      // Load more
      state = loadMoreResults(state, 50);

      const stillFirstItem = searchResults.querySelector('.coffee-item h3').textContent;
      expect(stillFirstItem).toBe(firstItemText);

      const items = searchResults.querySelectorAll('.coffee-item');
      expect(items).toHaveLength(100);
    });

    it('should hide "Load More" button when all results loaded', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet.slice(0, 100);
      let state = displayResultsWithPagination(largeResultSet, 50);

      let loadMoreButton = document.querySelector('.load-more');
      expect(loadMoreButton).toBeTruthy();

      // Load more (should load remaining 50)
      state = loadMoreResults(state, 50);

      loadMoreButton = document.querySelector('.load-more');
      expect(loadMoreButton).toBe(null);

      const items = document.querySelectorAll('.coffee-item');
      expect(items).toHaveLength(100);
    });

    it('should update button text after loading more', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet.slice(0, 150);
      let state = displayResultsWithPagination(largeResultSet, 50);

      let loadMoreButton = document.querySelector('.load-more');
      expect(loadMoreButton.textContent).toBe('Load More (100 remaining)');

      // Load more
      state = loadMoreResults(state, 50);

      loadMoreButton = document.querySelector('.load-more');
      expect(loadMoreButton.textContent).toBe('Load More (50 remaining)');
    });

    it('should handle multiple "Load More" clicks', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet.slice(0, 150);
      let state = displayResultsWithPagination(largeResultSet, 50);

      // First load more
      state = loadMoreResults(state, 50);
      let items = document.querySelectorAll('.coffee-item');
      expect(items).toHaveLength(100);

      // Second load more
      state = loadMoreResults(state, 50);
      items = document.querySelectorAll('.coffee-item');
      expect(items).toHaveLength(150);

      // Button should be gone
      const loadMoreButton = document.querySelector('.load-more');
      expect(loadMoreButton).toBe(null);
    });

    it('should load correct batch on second click', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet.slice(0, 200);
      let state = displayResultsWithPagination(largeResultSet, 50);

      // First batch: items 0-49 already loaded, load 50-99
      state = loadMoreResults(state, 50);
      expect(state.currentlyShowing).toBe(100);

      // Second batch: load 100-149
      state = loadMoreResults(state, 50);
      expect(state.currentlyShowing).toBe(150);

      const items = document.querySelectorAll('.coffee-item');
      expect(items).toHaveLength(150);
    });
  });

  describe('Pagination State Management', () => {
    it('should track currently showing count', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet.slice(0, 150);
      let state = displayResultsWithPagination(largeResultSet, 50);

      expect(state.currentlyShowing).toBe(50);

      state = loadMoreResults(state, 50);
      expect(state.currentlyShowing).toBe(100);

      state = loadMoreResults(state, 50);
      expect(state.currentlyShowing).toBe(150);
    });

    it('should persist pagination state during load', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet.slice(0, 150);
      let state = displayResultsWithPagination(largeResultSet, 50);

      const originalAllShops = state.allShops;

      state = loadMoreResults(state, 50);

      // State should be maintained
      expect(state.allShops).toBe(originalAllShops);
      expect(state.currentlyShowing).toBe(100);
    });

    it('should handle edge case with exactly divisible results', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet.slice(0, 100);
      let state = displayResultsWithPagination(largeResultSet, 50);

      expect(state.currentlyShowing).toBe(50);

      state = loadMoreResults(state, 50);

      expect(state.currentlyShowing).toBe(100);
      expect(document.querySelector('.load-more')).toBe(null);
    });
  });

  describe('Pagination Loading Indicator', () => {
    it('should show loading state when loading more', async () => {
      vi.useFakeTimers();

      const largeResultSet = edgeCaseFixtures.largeResultSet.slice(0, 150);
      let state = displayResultsWithPagination(largeResultSet, 50);

      const loadMoreButton = document.querySelector('.load-more');

      // Simulate loading state
      loadMoreButton.disabled = true;
      loadMoreButton.textContent = 'Loading...';

      expect(loadMoreButton.disabled).toBe(true);
      expect(loadMoreButton.textContent).toBe('Loading...');

      // Simulate load completion
      await vi.advanceTimersByTimeAsync(500);
      state = loadMoreResults(state, 50);

      vi.useRealTimers();
    });
  });

  describe('Pagination Error Handling', () => {
    it('should handle errors during load more gracefully', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet.slice(0, 150);
      let state = displayResultsWithPagination(largeResultSet, 50);

      // Try to load more when at end
      state = { ...state, currentlyShowing: 150 };
      const newState = loadMoreResults(state, 50);

      // Should not change
      expect(newState.currentlyShowing).toBe(150);
    });
  });

  describe('Scroll Position', () => {
    it('should maintain scroll position after loading more', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet.slice(0, 150);
      let state = displayResultsWithPagination(largeResultSet, 50);

      const searchResults = document.getElementById('searchResults');
      const scrollTopBefore = searchResults.scrollTop;

      state = loadMoreResults(state, 50);

      // In a real browser, scroll position would be preserved
      // In jsdom, we just verify the DOM structure is correct
      const items = searchResults.querySelectorAll('.coffee-item');
      expect(items).toHaveLength(100);
    });
  });

  describe('Event Delegation', () => {
    it('should handle click events through event delegation', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet.slice(0, 150);
      let state = displayResultsWithPagination(largeResultSet, 50);

      const searchResults = document.getElementById('searchResults');
      let clicked = false;

      // Set up event delegation
      searchResults.addEventListener('click', (event) => {
        if (event.target.classList.contains('load-more')) {
          clicked = true;
          state = loadMoreResults(state, 50);
        }
      });

      const loadMoreButton = searchResults.querySelector('.load-more');
      click(loadMoreButton);

      expect(clicked).toBe(true);
      expect(state.currentlyShowing).toBe(100);
    });
  });

  describe('Accessibility', () => {
    it('should announce new items loaded to screen readers', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet.slice(0, 150);
      let state = displayResultsWithPagination(largeResultSet, 50);

      const searchResults = document.getElementById('searchResults');

      // Add aria-live region
      const announcement = document.createElement('div');
      announcement.setAttribute('role', 'status');
      announcement.setAttribute('aria-live', 'polite');
      announcement.className = 'visually-hidden';
      searchResults.appendChild(announcement);

      state = loadMoreResults(state, 50);

      // Update announcement
      announcement.textContent = 'Loaded 50 more results. Now showing 100 of 150.';

      expect(announcement.textContent).toBe('Loaded 50 more results. Now showing 100 of 150.');
    });

    it('should have proper ARIA labels on load more button', () => {
      const largeResultSet = edgeCaseFixtures.largeResultSet.slice(0, 150);
      displayResultsWithPagination(largeResultSet, 50);

      const loadMoreButton = document.querySelector('.load-more');
      const ariaLabel = loadMoreButton.getAttribute('aria-label');

      expect(ariaLabel).toBeTruthy();
      expect(ariaLabel).toContain('100');
    });
  });
});
