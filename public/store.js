/**
 * Store — explicit pub/sub state container (ADR-0001).
 *
 * Five-method interface: { get, set, update, subscribe, snapshot }.
 *
 * The schema is fixed at construction by the initial state's keys —
 * `set`/`update`/`subscribe` on an unknown key throws (typo guard).
 *
 * Shallow-equality contract on `set`/`update`:
 *   - Primitives & refs are compared via Object.is.
 *   - Arrays are compared element-wise (Object.is per index, lengths equal).
 *   - Plain objects are compared by shallow keys (Object.is per value).
 *   - Map / Set instances ALWAYS fail equality (force "replace with new
 *     reference" discipline; in-place mutation followed by set(sameRef)
 *     still notifies because the equality check short-circuits to false).
 *
 * When the new value is shallow-equal to the current value, `set`/`update`
 * are no-ops: no state change, no subscriber notification, return false.
 *
 * Subscribers fire synchronously, in registration order. A throwing
 * subscriber is logged via console.error and does NOT prevent siblings
 * from firing.
 *
 * Deliberately omitted (see ADR-0001):
 *   - subscribeAll: discourages "re-render everything" anti-pattern.
 *   - transaction / batch: premature until a real ordering case appears.
 *
 * UMD-style: assigns to `window.CoffeeShopStore` in the browser, exports
 * via CommonJS for Node tests.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  } else if (typeof window !== 'undefined') {
    window.CoffeeShopStore = mod;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function shallowEqual(a, b) {
    // Map / Set are checked BEFORE Object.is — the contract is that
    // mutating a collection in place and handing back the same reference
    // should still notify. If we let Object.is short-circuit here, the
    // common `update('cache', m => { m.set(k, v); return m; })` pattern
    // would silently no-op.
    if (a instanceof Map || b instanceof Map) return false;
    if (a instanceof Set || b instanceof Set) return false;

    if (Object.is(a, b)) return true;
    if (a == null || b == null) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;

    // Array — shallow element comparison.
    const aIsArr = Array.isArray(a);
    const bIsArr = Array.isArray(b);
    if (aIsArr !== bIsArr) return false;
    if (aIsArr) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!Object.is(a[i], b[i])) return false;
      }
      return true;
    }

    // Plain objects — shallow key comparison.
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!Object.is(a[k], b[k])) return false;
    }
    return true;
  }

  function createStore(initialState) {
    if (!initialState || typeof initialState !== 'object' || Array.isArray(initialState)) {
      throw new TypeError('createStore requires an initial state object');
    }

    const state = Object.assign({}, initialState);
    const subscribers = new Map(); // key -> Set<fn>
    for (const k of Object.keys(state)) {
      subscribers.set(k, new Set());
    }

    function _assertKey(key) {
      if (!subscribers.has(key)) {
        const declared = [...subscribers.keys()].join(', ');
        throw new Error(`Unknown store key: "${key}". Declared keys: ${declared}`);
      }
    }

    function get(key) {
      _assertKey(key);
      return state[key];
    }

    /**
     * Set `key` to `value`. No-op (returns false) when shallow-equal to
     * the current value. Returns true when state changed and subscribers
     * fired.
     */
    function set(key, value) {
      _assertKey(key);
      if (shallowEqual(state[key], value)) return false;
      const prev = state[key];
      state[key] = value;
      for (const fn of subscribers.get(key)) {
        try {
          fn(value, prev);
        } catch (err) {
          console.error(`Store subscriber for "${key}" threw:`, err);
        }
      }
      return true;
    }

    /**
     * The safe mutation path: `updater(prev) => next`. Always produce a
     * NEW reference for collections — returning the same reference after
     * in-place mutation works for Map/Set (which always fail equality)
     * but no-ops for arrays/objects (shallow-equal to themselves).
     */
    function update(key, updater) {
      _assertKey(key);
      if (typeof updater !== 'function') {
        throw new TypeError('update requires an updater function (prev) => next');
      }
      const next = updater(state[key]);
      return set(key, next);
    }

    function subscribe(key, fn) {
      _assertKey(key);
      if (typeof fn !== 'function') {
        throw new TypeError('subscribe requires a function');
      }
      const set_ = subscribers.get(key);
      set_.add(fn);
      return function unsubscribe() {
        set_.delete(fn);
      };
    }

    function snapshot() {
      return Object.freeze(Object.assign({}, state));
    }

    return { get, set, update, subscribe, snapshot };
  }

  return { createStore };
});
