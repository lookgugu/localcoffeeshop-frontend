import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { fixtureCoffeeShops, fixtureStates } from './fixtures.js';

// Default handlers; individual tests override with server.use().
// Responses use the real API envelope that public/api-client.js expects.
export const handlers = [
  http.get('*/api/v1/states', () => HttpResponse.json({ success: true, data: fixtureStates })),
  http.get('*/api/v1/search', () => HttpResponse.json({ success: true, data: fixtureCoffeeShops }))
];

export const server = setupServer(...handlers);
