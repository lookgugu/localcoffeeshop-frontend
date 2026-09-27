/**
 * Contract check: the default MSW handlers in tests/helpers/mockApi.js must
 * return responses the production ApiClient can consume. Guards against test
 * mocks drifting from the real wire format.
 */

import { describe, it, expect, afterEach } from 'vitest';
import api from '../../public/api-client.js';
import { fixtureCoffeeShops, fixtureStates } from '../helpers/fixtures.js';

afterEach(() => {
  api._resetBaseUrl();
});

describe('Default mock API handlers', () => {
  it('serve /states in a shape ApiClient unwraps to the state list', async () => {
    await expect(api.get('/states')).resolves.toEqual(fixtureStates);
  });

  it('serve /search in a shape ApiClient unwraps to a shop array', async () => {
    await expect(api.get('/search')).resolves.toEqual(fixtureCoffeeShops);
  });
});
