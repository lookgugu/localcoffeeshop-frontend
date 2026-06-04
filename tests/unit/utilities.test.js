/**
 * Unit Tests: Utility Functions
 *
 * After the enums consolidation (candidate #2), the price/state helpers
 * are covered by tests/unit/enums.test.js. This file keeps only the
 * non-enum utilities — currently just the Haversine distance calculation
 * that still lives inline in frontend.js.
 */

import { describe, it, expect } from 'vitest';

describe('Utility Functions', () => {
  describe('calculateDistance (Haversine formula)', () => {
    // Implementation mirrors frontend.js — kept here so we can unit-test it
    // without importing the IIFE-wrapped module.
    function calculateDistance(lat1, lon1, lat2, lon2) {
      const R = 6371; // Radius of the earth in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const d = R * c; // Distance in km
      return d;
    }

    it('should calculate zero distance for same coordinates', () => {
      const distance = calculateDistance(37.7749, -122.4194, 37.7749, -122.4194);
      expect(distance).toBe(0);
    });

    it('should calculate distance between San Francisco and Los Angeles (~559 km)', () => {
      const distance = calculateDistance(37.7749, -122.4194, 34.0522, -118.2437);
      expect(distance).toBeGreaterThan(530);
      expect(distance).toBeLessThan(590);
    });

    it('should calculate distance between New York and Boston (~306 km)', () => {
      const distance = calculateDistance(40.7128, -74.0060, 42.3601, -71.0589);
      expect(distance).toBeGreaterThan(290);
      expect(distance).toBeLessThan(325);
    });

    it('should calculate distance between Seattle and Portland (~233 km)', () => {
      const distance = calculateDistance(47.6062, -122.3321, 45.5152, -122.6784);
      expect(distance).toBeGreaterThan(220);
      expect(distance).toBeLessThan(250);
    });

    it('should be symmetric (distance A to B equals B to A)', () => {
      const lat1 = 37.7749, lon1 = -122.4194;
      const lat2 = 34.0522, lon2 = -118.2437;
      const distanceAtoB = calculateDistance(lat1, lon1, lat2, lon2);
      const distanceBtoA = calculateDistance(lat2, lon2, lat1, lon1);
      expect(distanceAtoB).toBeCloseTo(distanceBtoA, 10);
    });

    it('should handle equator crossing', () => {
      const distance = calculateDistance(10, 0, -10, 0);
      expect(distance).toBeGreaterThan(2200);
      expect(distance).toBeLessThan(2300);
    });

    it('should handle prime meridian crossing', () => {
      const distance = calculateDistance(0, -10, 0, 10);
      expect(distance).toBeGreaterThan(2200);
      expect(distance).toBeLessThan(2300);
    });

    it('should handle antipodal points (opposite sides of Earth)', () => {
      const distance = calculateDistance(40, 0, -40, 180);
      expect(distance).toBeGreaterThan(15000);
      expect(distance).toBeLessThan(21000);
    });

    it('should handle North and South poles', () => {
      const distance = calculateDistance(90, 0, -90, 0);
      expect(distance).toBeGreaterThan(19500);
      expect(distance).toBeLessThan(20500);
    });

    it('should return valid number for all valid inputs', () => {
      const distance = calculateDistance(0, 0, 1, 1);
      expect(typeof distance).toBe('number');
      expect(Number.isNaN(distance)).toBe(false);
      expect(Number.isFinite(distance)).toBe(true);
      expect(distance).toBeGreaterThanOrEqual(0);
    });
  });
});
