/**
 * Unit Tests: Validation Functions
 * Tests validation functions for API responses, shops, and state info
 */

import { describe, it, expect } from 'vitest';
import { fixtureCoffeeShops } from '../helpers/fixtures.js';
import enums from '../../public/enums.js';

const { isStateCode } = enums;

describe('Validation Functions', () => {
  // Note: state-code validation is exhaustively covered by tests/unit/enums.test.js.
  // This block keeps a smoke check at the validation seam to surface accidental
  // wiring changes in the consumer (frontend.js / state.js / submit.js).
  describe('isStateCode (from CoffeeShopEnums)', () => {
    it('returns true for valid uppercase state codes', () => {
      expect(isStateCode('CA')).toBe(true);
      expect(isStateCode('NY')).toBe(true);
      expect(isStateCode('TX')).toBe(true);
    });

    it('returns true for lowercase state codes (upgraded behaviour vs old regex)', () => {
      // The new helper is case-insensitive — this is an intentional improvement
      // over the old constants.js regex that required uppercase.
      expect(isStateCode('ca')).toBe(true);
      expect(isStateCode('ny')).toBe(true);
    });

    it('returns false for unknown two-letter strings', () => {
      expect(isStateCode('ZZ')).toBe(false);
      expect(isStateCode('XX')).toBe(false);
    });

    it('returns false for null/undefined/non-string', () => {
      expect(isStateCode(null)).toBe(false);
      expect(isStateCode(undefined)).toBe(false);
      expect(isStateCode(42)).toBe(false);
    });
  });

  // Note: validateApiResponse, isValidShop, and isValidStateInfo are defined in frontend.js
  // which is wrapped in an IIFE and not exported. We'll test them indirectly through
  // integration tests, or we'd need to refactor frontend.js to export these functions.
  // For now, we'll create mock implementations to test the validation logic pattern.

  describe('API Response Validation Pattern', () => {
    // Test the validation pattern that should be used
    function validateApiResponse(result) {
      if (!result) {
        return { valid: false, data: [], error: 'Empty response from server' };
      }

      if (result.success === false) {
        const errorMsg = result.error?.message || 'Unknown server error';
        return { valid: false, data: [], error: errorMsg };
      }

      const data = result.success ? result.data : result;

      if (!Array.isArray(data)) {
        return { valid: false, data: [], error: 'Invalid data format: expected array' };
      }

      return { valid: true, data, error: null };
    }

    it('should return valid for correct API response format', () => {
      const response = { success: true, data: fixtureCoffeeShops };
      const result = validateApiResponse(response);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual(fixtureCoffeeShops);
      expect(result.error).toBe(null);
    });

    it('should return valid for unwrapped array response', () => {
      const response = fixtureCoffeeShops;
      const result = validateApiResponse(response);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual(fixtureCoffeeShops);
      expect(result.error).toBe(null);
    });

    it('should return valid for empty array response', () => {
      const response = { success: true, data: [] };
      const result = validateApiResponse(response);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual([]);
      expect(result.error).toBe(null);
    });

    it('should return invalid for null response', () => {
      const result = validateApiResponse(null);

      expect(result.valid).toBe(false);
      expect(result.data).toEqual([]);
      expect(result.error).toBe('Empty response from server');
    });

    it('should return invalid for undefined response', () => {
      const result = validateApiResponse(undefined);

      expect(result.valid).toBe(false);
      expect(result.data).toEqual([]);
      expect(result.error).toBe('Empty response from server');
    });

    it('should return invalid for error response without message', () => {
      const response = { success: false };
      const result = validateApiResponse(response);

      expect(result.valid).toBe(false);
      expect(result.data).toEqual([]);
      expect(result.error).toBe('Unknown server error');
    });

    it('should return invalid for error response with message', () => {
      const response = { success: false, error: { message: 'Database connection failed' } };
      const result = validateApiResponse(response);

      expect(result.valid).toBe(false);
      expect(result.data).toEqual([]);
      expect(result.error).toBe('Database connection failed');
    });

    it('should return invalid for non-array data', () => {
      const response = { success: true, data: 'not an array' };
      const result = validateApiResponse(response);

      expect(result.valid).toBe(false);
      expect(result.data).toEqual([]);
      expect(result.error).toBe('Invalid data format: expected array');
    });

    it('should return invalid for object data instead of array', () => {
      const response = { success: true, data: { shops: [] } };
      const result = validateApiResponse(response);

      expect(result.valid).toBe(false);
      expect(result.data).toEqual([]);
      expect(result.error).toBe('Invalid data format: expected array');
    });

    it('should return invalid for number data', () => {
      const response = { success: true, data: 123 };
      const result = validateApiResponse(response);

      expect(result.valid).toBe(false);
      expect(result.data).toEqual([]);
      expect(result.error).toBe('Invalid data format: expected array');
    });
  });

  describe('Shop Object Validation Pattern', () => {
    function isValidShop(shop) {
      return shop &&
        typeof shop === 'object' &&
        shop.displayName &&
        typeof shop.displayName.text === 'string';
    }

    it('should return true for valid shop object', () => {
      const shop = {
        displayName: { text: 'Test Coffee Shop' },
        formattedAddress: '123 Main St, City, CA 90000',
        priceLevel: 'PRICE_LEVEL_MODERATE'
      };

      expect(isValidShop(shop)).toBe(true);
    });

    it('should return true for shop with minimal required fields', () => {
      const shop = {
        displayName: { text: 'Minimal Shop' }
      };

      expect(isValidShop(shop)).toBe(true);
    });

    it('should return true for fixture shops', () => {
      fixtureCoffeeShops.forEach(shop => {
        expect(isValidShop(shop)).toBe(true);
      });
    });

    it('should return false for null', () => {
      expect(isValidShop(null)).toBeFalsy();
    });

    it('should return false for undefined', () => {
      expect(isValidShop(undefined)).toBeFalsy();
    });

    it('should return false for shop without displayName', () => {
      const shop = {
        formattedAddress: '123 Main St',
        priceLevel: 'PRICE_LEVEL_MODERATE'
      };

      expect(isValidShop(shop)).toBeFalsy();
    });

    it('should return false for shop with null displayName', () => {
      const shop = {
        displayName: null,
        formattedAddress: '123 Main St'
      };

      expect(isValidShop(shop)).toBeFalsy();
    });

    it('should return false for shop with displayName but no text', () => {
      const shop = {
        displayName: { languageCode: 'en' },
        formattedAddress: '123 Main St'
      };

      expect(isValidShop(shop)).toBe(false);
    });

    it('should return false for shop with non-string text', () => {
      const shop = {
        displayName: { text: 123 },
        formattedAddress: '123 Main St'
      };

      expect(isValidShop(shop)).toBe(false);
    });

    it('should return true for shop with empty string text', () => {
      const shop = {
        displayName: { text: '' }
      };

      // Empty string is still a string, so this should pass
      expect(isValidShop(shop)).toBe(true);
    });

    it('should return false for non-object shop', () => {
      expect(isValidShop('shop')).toBe(false);
      expect(isValidShop(123)).toBe(false);
      expect(isValidShop(true)).toBe(false);
    });

    it('should return false for array instead of object', () => {
      // Arrays are technically objects, but should fail the displayName check
      const result = isValidShop([]);
      // Arrays will return undefined for displayName.text, which is falsy
      expect(result).toBeFalsy();
    });
  });

  describe('State Info Validation Pattern', () => {
    function isValidStateInfo(stateInfo) {
      // Check for null/undefined first, before checking typeof
      if (!stateInfo) {
        return false;
      }
      return typeof stateInfo === 'object' &&
        typeof stateInfo.state_code === 'string' &&
        typeof stateInfo.shop_count === 'number';
    }

    it('should return true for valid state info object', () => {
      const stateInfo = {
        state_code: 'CA',
        shop_count: 1250,
        avg_price_level: 2.5
      };

      expect(isValidStateInfo(stateInfo)).toBe(true);
    });

    it('should return true for state info with minimal fields', () => {
      const stateInfo = {
        state_code: 'NY',
        shop_count: 875
      };

      expect(isValidStateInfo(stateInfo)).toBe(true);
    });

    it('should return true for state info with zero shops', () => {
      const stateInfo = {
        state_code: 'WY',
        shop_count: 0
      };

      expect(isValidStateInfo(stateInfo)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isValidStateInfo(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidStateInfo(undefined)).toBe(false);
    });

    it('should return false for missing state_code', () => {
      const stateInfo = {
        shop_count: 100,
        avg_price_level: 2.0
      };

      expect(isValidStateInfo(stateInfo)).toBe(false);
    });

    it('should return false for missing shop_count', () => {
      const stateInfo = {
        state_code: 'CA',
        avg_price_level: 2.0
      };

      expect(isValidStateInfo(stateInfo)).toBe(false);
    });

    it('should return false for non-string state_code', () => {
      const stateInfo = {
        state_code: 123,
        shop_count: 100
      };

      expect(isValidStateInfo(stateInfo)).toBe(false);
    });

    it('should return false for non-number shop_count', () => {
      const stateInfo = {
        state_code: 'CA',
        shop_count: '100'
      };

      expect(isValidStateInfo(stateInfo)).toBe(false);
    });

    it('should return false for non-object types', () => {
      expect(isValidStateInfo('state')).toBe(false);
      expect(isValidStateInfo(123)).toBe(false);
      expect(isValidStateInfo(true)).toBe(false);
      expect(isValidStateInfo([])).toBe(false);
    });
  });
});
