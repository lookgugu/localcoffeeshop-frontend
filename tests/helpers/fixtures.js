/**
 * Shared test fixtures
 * Shapes mirror the API: shops use Google Places fields (displayName.text,
 * formattedAddress, priceLevel) plus our `state`; state info uses snake_case.
 */

export const fixtureCoffeeShops = [
  { displayName: { text: 'The Coffee House' }, formattedAddress: '123 Main St, San Francisco, CA', state: 'CA', priceLevel: 'PRICE_LEVEL_MODERATE', lat: 37.7749, lon: -122.4194 },
  { displayName: { text: 'Java Junction' }, formattedAddress: '456 Market St, San Francisco, CA', state: 'CA', priceLevel: 'PRICE_LEVEL_INEXPENSIVE', lat: 37.795, lon: -122.404 },
  { displayName: { text: 'Daily Grind' }, formattedAddress: '789 Mission St, San Francisco, CA', state: 'CA', priceLevel: 'PRICE_LEVEL_EXPENSIVE', lat: 37.783, lon: -122.408 },
  { displayName: { text: 'Empire Espresso' }, formattedAddress: '12 Broadway, New York, NY', state: 'NY', priceLevel: 'PRICE_LEVEL_MODERATE', lat: 40.7128, lon: -74.006 },
  { displayName: { text: 'Lone Star Roasters' }, formattedAddress: '300 Congress Ave, Austin, TX', state: 'TX', priceLevel: 'PRICE_LEVEL_INEXPENSIVE', lat: 30.2672, lon: -97.7431 },
  { displayName: { text: 'Alabama Coffee' }, formattedAddress: '101 Alabama St, Mobile, AL', state: 'AL', priceLevel: 'PRICE_LEVEL_MODERATE', lat: 30.6954, lon: -88.0399 },
  { displayName: { text: 'Arizona Brew' }, formattedAddress: '202 Arizona Ave, Phoenix, AZ', state: 'AZ', priceLevel: 'PRICE_LEVEL_INEXPENSIVE', lat: 33.4484, lon: -112.074 }
];

// First entry must be CA: state-grid tests expect the first card to read "California".
export const fixtureStates = [
  { state: 'CA', state_code: 'CA', shop_count: 1250, avg_price_level: 2.3 },
  { state: 'NY', state_code: 'NY', shop_count: 875, avg_price_level: 2.6 },
  { state: 'TX', state_code: 'TX', shop_count: 640, avg_price_level: 1.8 },
  { state: 'AL', state_code: 'AL', shop_count: 120, avg_price_level: 1.4 },
  { state: 'AZ', state_code: 'AZ', shop_count: 310, avg_price_level: 2.0 }
];

const PRICE_LEVELS = ['PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE'];

export const edgeCaseFixtures = {
  // 200 shops — pagination tests slice up to 200
  largeResultSet: Array.from({ length: 200 }, (_, i) => ({
    displayName: { text: `Coffee Shop ${i + 1}` },
    formattedAddress: `${i + 1} Test St, Los Angeles, CA`,
    state: 'CA',
    priceLevel: PRICE_LEVELS[i % PRICE_LEVELS.length]
  })),
  emptyResults: []
};
