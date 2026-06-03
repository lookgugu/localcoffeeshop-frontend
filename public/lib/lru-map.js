/**
 * LruMap — a tiny eviction-aware Map with a fixed maximum size.
 *
 * Insertion order is recency; reading a key bumps it to most-recent by
 * delete + re-insert. When set would exceed maxSize, the oldest key is
 * evicted. Used as the value of the frontend's `dataCache` store key so
 * cache-size bookkeeping stays out of the store interface.
 *
 * UMD-style: assigns to `window.CoffeeShopLruMap` in the browser,
 * exports via CommonJS for Node tests.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  } else if (typeof window !== 'undefined') {
    window.CoffeeShopLruMap = mod;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class LruMap {
    constructor(maxSize) {
      if (!Number.isInteger(maxSize) || maxSize <= 0) {
        throw new TypeError('LruMap requires a positive integer maxSize');
      }
      this._max = maxSize;
      this._map = new Map();
    }

    get size() {
      return this._map.size;
    }

    has(key) {
      return this._map.has(key);
    }

    get(key) {
      if (!this._map.has(key)) return undefined;
      const val = this._map.get(key);
      // Bump recency: delete then re-insert moves the key to the end.
      this._map.delete(key);
      this._map.set(key, val);
      return val;
    }

    set(key, val) {
      if (this._map.has(key)) {
        // Re-insert to bump recency; size unchanged.
        this._map.delete(key);
      } else if (this._map.size >= this._max) {
        // Evict the oldest (first-inserted, least-recently-used) key.
        const oldest = this._map.keys().next().value;
        this._map.delete(oldest);
      }
      this._map.set(key, val);
      return this;
    }

    delete(key) {
      return this._map.delete(key);
    }

    clear() {
      this._map.clear();
    }

    entries() {
      return this._map.entries();
    }

    keys() {
      return this._map.keys();
    }

    values() {
      return this._map.values();
    }

    [Symbol.iterator]() {
      return this._map[Symbol.iterator]();
    }
  }

  return { LruMap };
});
