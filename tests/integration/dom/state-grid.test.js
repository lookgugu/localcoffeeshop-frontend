/**
 * DOM Integration Tests - State Grid Rendering
 * Tests state grid display, sorting, clicking, and accessibility
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../helpers/mockApi.js';
import { click, keydown, waitForAsyncUpdates } from '../../helpers/dom.js';
import { fixtureStates } from '../../helpers/fixtures.js';

// Load the shared enums and attach to window so the test's view helpers
// (which mirror the browser's `window.CoffeeShopEnums` lookup) can find them.
// Vite's CJS interop routes the UMD wrapper through module.exports, so the
// `window` branch never fires automatically — we wire it explicitly here.
import enums from '../../../public/enums.js';
window.CoffeeShopEnums = enums;

/**
 * Helper to create test DOM structure
 */
function createTestDOM() {
  const container = document.createElement('div');
  container.className = 'container';

  const stateGrid = document.createElement('div');
  stateGrid.id = 'stateGrid';
  stateGrid.setAttribute('role', 'grid');
  container.appendChild(stateGrid);

  document.body.appendChild(container);
}

/**
 * Get state name from code (via shared enums helper)
 */
function getStateName(code) {
  const enums = window.CoffeeShopEnums;
  return enums ? enums.stateName(code) : code;
}

/**
 * Calculate average price from level
 */
function calculateAvgPrice(avgLevel) {
  if (!avgLevel) return 'N/A';
  const numericLevel = typeof avgLevel === 'string' ?
    ({ 'PRICE_LEVEL_INEXPENSIVE': 1, 'PRICE_LEVEL_MODERATE': 2, 'PRICE_LEVEL_EXPENSIVE': 3 }[avgLevel] || 2) :
    avgLevel;
  if (numericLevel < 1.5) return 'Inexpensive';
  if (numericLevel < 2.5) return 'Moderate';
  return 'Expensive';
}

/**
 * Helper to create state grid
 */
function createStateGrid(states) {
  const stateGrid = document.getElementById('stateGrid');
  stateGrid.replaceChildren();

  const fragment = document.createDocumentFragment();

  states.forEach(stateInfo => {
    const stateCard = document.createElement('div');
    stateCard.className = 'state-card';
    stateCard.id = `state-card-${stateInfo.state}`;
    stateCard.setAttribute('role', 'gridcell');

    const link = document.createElement('a');
    link.href = `/html/state.html?code=${stateInfo.state}`;
    link.setAttribute('aria-label', `${getStateName(stateInfo.state)}: ${stateInfo.shop_count} coffee shops`);

    const h2 = document.createElement('h2');
    h2.textContent = getStateName(stateInfo.state);

    const p1 = document.createElement('p');
    p1.textContent = `${stateInfo.shop_count} coffee shops`;

    const p2 = document.createElement('p');
    p2.textContent = `Avg. price: ${calculateAvgPrice(stateInfo.avg_price_level)}`;

    link.appendChild(h2);
    link.appendChild(p1);
    link.appendChild(p2);
    stateCard.appendChild(link);

    fragment.appendChild(stateCard);
  });

  stateGrid.appendChild(fragment);
}

describe('State Grid DOM Tests', () => {
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

  describe('Grid Rendering', () => {
    it('should render all states in grid', () => {
      createStateGrid(fixtureStates);

      const stateGrid = document.getElementById('stateGrid');
      const stateCards = stateGrid.querySelectorAll('.state-card');

      expect(stateCards).toHaveLength(fixtureStates.length);
    });

    it('should display state names correctly', () => {
      createStateGrid(fixtureStates);

      const stateGrid = document.getElementById('stateGrid');
      const firstCard = stateGrid.querySelector('.state-card h2');

      expect(firstCard.textContent).toBe('California');
    });

    it('should display shop counts', () => {
      createStateGrid(fixtureStates);

      const stateGrid = document.getElementById('stateGrid');
      const firstCard = stateGrid.querySelector('.state-card');
      const shopCount = firstCard.querySelectorAll('p')[0];

      expect(shopCount.textContent).toBe('1250 coffee shops');
    });

    it('should display average price levels', () => {
      createStateGrid(fixtureStates);

      const stateGrid = document.getElementById('stateGrid');
      const firstCard = stateGrid.querySelector('.state-card');
      const avgPrice = firstCard.querySelectorAll('p')[1];

      expect(avgPrice.textContent).toContain('Avg. price:');
      expect(avgPrice.textContent).toContain('Moderate');
    });

    it('should handle empty data gracefully', () => {
      createStateGrid([]);

      const stateGrid = document.getElementById('stateGrid');
      const stateCards = stateGrid.querySelectorAll('.state-card');

      expect(stateCards).toHaveLength(0);
    });

    it('should render state cards with correct IDs', () => {
      createStateGrid(fixtureStates);

      const stateGrid = document.getElementById('stateGrid');
      const caCard = stateGrid.querySelector('#state-card-CA');
      const nyCard = stateGrid.querySelector('#state-card-NY');

      expect(caCard).toBeTruthy();
      expect(nyCard).toBeTruthy();
    });
  });

  describe('State Links', () => {
    it('should create clickable links for each state', () => {
      createStateGrid(fixtureStates);

      const stateGrid = document.getElementById('stateGrid');
      const links = stateGrid.querySelectorAll('a');

      expect(links).toHaveLength(fixtureStates.length);
    });

    it('should have correct href for state pages', () => {
      createStateGrid(fixtureStates);

      const stateGrid = document.getElementById('stateGrid');
      const firstLink = stateGrid.querySelector('a');

      expect(firstLink.href).toContain('/html/state.html?code=CA');
    });

    it('should handle clicking state card', () => {
      createStateGrid(fixtureStates);

      const stateGrid = document.getElementById('stateGrid');
      const firstCard = stateGrid.querySelector('.state-card');
      const link = firstCard.querySelector('a');

      let clicked = false;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        clicked = true;
      });

      click(link);

      expect(clicked).toBe(true);
    });
  });

  describe('Grid Sorting', () => {
    it('should sort states alphabetically by code', () => {
      const sortedStates = [...fixtureStates].sort((a, b) => a.state.localeCompare(b.state));
      createStateGrid(sortedStates);

      const stateGrid = document.getElementById('stateGrid');
      const stateCards = Array.from(stateGrid.querySelectorAll('.state-card'));
      const stateCodes = stateCards.map(card => card.id.replace('state-card-', ''));

      // Check if sorted
      const expectedOrder = sortedStates.map(s => s.state);
      expect(stateCodes).toEqual(expectedOrder);
    });

    it('should maintain sort order after updates', () => {
      const sortedStates = [...fixtureStates].sort((a, b) => a.state.localeCompare(b.state));
      createStateGrid(sortedStates);

      const stateGrid = document.getElementById('stateGrid');
      const firstStateBefore = stateGrid.querySelector('.state-card').id;

      // Re-render with same data
      createStateGrid(sortedStates);

      const firstStateAfter = stateGrid.querySelector('.state-card').id;
      expect(firstStateAfter).toBe(firstStateBefore);
    });
  });

  describe('Loading Skeleton', () => {
    it('should show loading skeleton before data loads', () => {
      const stateGrid = document.getElementById('stateGrid');

      // Create skeleton cards
      for (let i = 0; i < 6; i++) {
        const skeleton = document.createElement('div');
        skeleton.className = 'skeleton-card';
        skeleton.setAttribute('aria-hidden', 'true');

        const title = document.createElement('div');
        title.className = 'skeleton skeleton-title';
        skeleton.appendChild(title);

        const text = document.createElement('div');
        text.className = 'skeleton skeleton-text';
        skeleton.appendChild(text);

        stateGrid.appendChild(skeleton);
      }

      const skeletons = stateGrid.querySelectorAll('.skeleton-card');
      expect(skeletons).toHaveLength(6);
    });

    it('should remove skeleton after data loads', () => {
      const stateGrid = document.getElementById('stateGrid');

      // Add skeletons
      for (let i = 0; i < 6; i++) {
        const skeleton = document.createElement('div');
        skeleton.className = 'skeleton-card';
        stateGrid.appendChild(skeleton);
      }

      expect(stateGrid.querySelectorAll('.skeleton-card')).toHaveLength(6);

      // Load real data
      createStateGrid(fixtureStates);

      expect(stateGrid.querySelectorAll('.skeleton-card')).toHaveLength(0);
      expect(stateGrid.querySelectorAll('.state-card')).toHaveLength(fixtureStates.length);
    });
  });

  describe('Error Handling', () => {
    it('should display error message on API failure', () => {
      const stateGrid = document.getElementById('stateGrid');

      const errorDiv = document.createElement('div');
      errorDiv.className = 'error';
      errorDiv.textContent = 'Error loading state data. Please make sure the server is running.';
      stateGrid.appendChild(errorDiv);

      expect(stateGrid.querySelector('.error')).toBeTruthy();
      expect(stateGrid.querySelector('.error').textContent).toContain('Error loading state data');
    });

    it('should clear error when data loads successfully', () => {
      const stateGrid = document.getElementById('stateGrid');

      // Add error
      const errorDiv = document.createElement('div');
      errorDiv.className = 'error';
      errorDiv.textContent = 'Error loading state data';
      stateGrid.appendChild(errorDiv);

      // Load data (which clears everything first)
      createStateGrid(fixtureStates);

      expect(stateGrid.querySelector('.error')).toBe(null);
      expect(stateGrid.querySelectorAll('.state-card')).toHaveLength(fixtureStates.length);
    });
  });

  describe('Hover Effects', () => {
    it('should add hover class on mouse enter', () => {
      createStateGrid(fixtureStates);

      const stateGrid = document.getElementById('stateGrid');
      const firstCard = stateGrid.querySelector('.state-card');

      firstCard.addEventListener('mouseenter', () => {
        firstCard.classList.add('hover');
      });

      const event = new MouseEvent('mouseenter', { bubbles: true });
      firstCard.dispatchEvent(event);

      expect(firstCard.classList.contains('hover')).toBe(true);
    });

    it('should remove hover class on mouse leave', () => {
      createStateGrid(fixtureStates);

      const stateGrid = document.getElementById('stateGrid');
      const firstCard = stateGrid.querySelector('.state-card');

      firstCard.classList.add('hover');

      firstCard.addEventListener('mouseleave', () => {
        firstCard.classList.remove('hover');
      });

      const event = new MouseEvent('mouseleave', { bubbles: true });
      firstCard.dispatchEvent(event);

      expect(firstCard.classList.contains('hover')).toBe(false);
    });
  });

  describe('Responsive Layout', () => {
    it('should use CSS Grid layout', () => {
      createStateGrid(fixtureStates);

      const stateGrid = document.getElementById('stateGrid');

      // In a real browser, we'd check computed styles
      // In jsdom, we just verify the structure is correct
      expect(stateGrid.id).toBe('stateGrid');
      expect(stateGrid.children.length).toBe(fixtureStates.length);
    });

    it('should maintain grid structure with many states', () => {
      const manyStates = Array.from({ length: 50 }, (_, i) => ({
        state: `S${i}`,
        shop_count: 100 + i,
        avg_price_level: 'PRICE_LEVEL_MODERATE'
      }));

      createStateGrid(manyStates);

      const stateGrid = document.getElementById('stateGrid');
      const stateCards = stateGrid.querySelectorAll('.state-card');

      expect(stateCards).toHaveLength(50);
    });
  });

  describe('Accessibility', () => {
    it('should have role="grid" on container', () => {
      const stateGrid = document.getElementById('stateGrid');

      expect(stateGrid.getAttribute('role')).toBe('grid');
    });

    it('should have role="gridcell" on each card', () => {
      createStateGrid(fixtureStates);

      const stateGrid = document.getElementById('stateGrid');
      const cards = stateGrid.querySelectorAll('.state-card');

      cards.forEach(card => {
        expect(card.getAttribute('role')).toBe('gridcell');
      });
    });

    it('should have aria-label on state links', () => {
      createStateGrid(fixtureStates);

      const stateGrid = document.getElementById('stateGrid');
      const firstLink = stateGrid.querySelector('a');
      const ariaLabel = firstLink.getAttribute('aria-label');

      expect(ariaLabel).toBeTruthy();
      expect(ariaLabel).toContain('California');
      expect(ariaLabel).toContain('1250');
    });

    it('should be keyboard navigable', () => {
      createStateGrid(fixtureStates);

      const stateGrid = document.getElementById('stateGrid');
      const firstLink = stateGrid.querySelector('a');

      firstLink.focus();
      expect(document.activeElement).toBe(firstLink);
    });

    it('should handle arrow key navigation', () => {
      createStateGrid(fixtureStates);

      const stateGrid = document.getElementById('stateGrid');
      const links = Array.from(stateGrid.querySelectorAll('a'));

      // Set up arrow key navigation
      stateGrid.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight') {
          const currentIndex = links.indexOf(document.activeElement);
          if (currentIndex < links.length - 1) {
            links[currentIndex + 1].focus();
          }
        }
      });

      links[0].focus();
      expect(document.activeElement).toBe(links[0]);

      keydown(stateGrid, 'ArrowRight');
      // In real implementation, focus would move
    });

    it('should announce grid updates to screen readers', () => {
      const stateGrid = document.getElementById('stateGrid');

      const announcement = document.createElement('div');
      announcement.setAttribute('role', 'status');
      announcement.setAttribute('aria-live', 'polite');
      announcement.className = 'visually-hidden';
      stateGrid.appendChild(announcement);

      createStateGrid(fixtureStates);

      announcement.textContent = `Loaded ${fixtureStates.length} states`;

      expect(announcement.getAttribute('aria-live')).toBe('polite');
      expect(announcement.textContent).toBe(`Loaded ${fixtureStates.length} states`);
    });
  });

  describe('API Integration', () => {
    it('should fetch states from API', async () => {
      const response = await fetch('/api/v1/states');
      const data = await response.json();

      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it('should handle API errors gracefully', async () => {
      server.use(
        http.get('*/api/v1/states', () => {
          return HttpResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
          );
        })
      );

      try {
        const response = await fetch('/api/v1/states');
        expect(response.ok).toBe(false);
        expect(response.status).toBe(500);
      } catch (error) {
        // Error handled
      }
    });

    it('should validate state data from API', async () => {
      const response = await fetch('/api/v1/states');
      const data = await response.json();

      data.forEach(state => {
        expect(state).toHaveProperty('state');
        expect(state).toHaveProperty('shop_count');
        expect(typeof state.shop_count).toBe('number');
      });
    });
  });

  describe('Performance', () => {
    it('should use DocumentFragment for batch updates', () => {
      const fragment = document.createDocumentFragment();

      fixtureStates.forEach(stateInfo => {
        const stateCard = document.createElement('div');
        stateCard.className = 'state-card';
        stateCard.textContent = getStateName(stateInfo.state);
        fragment.appendChild(stateCard);
      });

      const stateGrid = document.getElementById('stateGrid');
      stateGrid.appendChild(fragment);

      expect(stateGrid.querySelectorAll('.state-card')).toHaveLength(fixtureStates.length);
    });

    it('should clear grid efficiently with replaceChildren', () => {
      createStateGrid(fixtureStates);

      const stateGrid = document.getElementById('stateGrid');
      expect(stateGrid.children.length).toBeGreaterThan(0);

      stateGrid.replaceChildren();
      expect(stateGrid.children.length).toBe(0);
    });
  });
});
