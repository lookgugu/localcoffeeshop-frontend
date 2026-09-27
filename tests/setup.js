import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './helpers/mockApi.js';

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  // Tests build their DOM in beforeEach; clear it so nodes and listeners don't leak across tests
  document.body.replaceChildren();
});
afterAll(() => server.close());
