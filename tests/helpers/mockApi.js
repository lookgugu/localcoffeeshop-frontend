import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { fixtureCoffeeShops, fixtureStates } from './fixtures.js';

// Default handlers; individual tests override with server.use().
export const handlers = [
  http.get('*/api/v1/states', () => HttpResponse.json(fixtureStates)),
  http.get('*/api/v1/search', () =>
    HttpResponse.json({ results: fixtureCoffeeShops, total: fixtureCoffeeShops.length })
  )
];

export const server = setupServer(...handlers);
