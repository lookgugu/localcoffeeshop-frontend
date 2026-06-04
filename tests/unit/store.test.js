/**
 * Unit Tests: Store (createStore)
 *
 * Covers the contract spelled out in ADR-0001 and tasks/todo.md candidate #5:
 *   - Five-method interface: get / set / update / subscribe / snapshot
 *   - Shallow-equality no-ops on set/update
 *   - Map and Set values ALWAYS notify (force "replace with new ref" discipline)
 *   - Subscribers fire synchronously in registration order
 *   - A throwing subscriber does NOT prevent siblings from firing
 *   - Unknown-key get/set/update/subscribe throw (typo guard)
 *   - snapshot() returns a frozen shallow clone
 *
 * UMD-style: default import gives us the module's exported object.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import StoreModule from '../../public/store.js';

const { createStore } = StoreModule;

describe('createStore — construction', () => {
  it('throws TypeError when initial state is missing', () => {
    expect(() => createStore()).toThrow(TypeError);
    expect(() => createStore(null)).toThrow(TypeError);
  });

  it('throws TypeError when initial state is not a plain object', () => {
    expect(() => createStore([])).toThrow(TypeError);
    expect(() => createStore('hi')).toThrow(TypeError);
    expect(() => createStore(42)).toThrow(TypeError);
  });

  it('declares the schema from initial state keys', () => {
    const store = createStore({ a: 1, b: 2 });
    expect(store.get('a')).toBe(1);
    expect(store.get('b')).toBe(2);
  });
});

describe('createStore — unknown-key guards', () => {
  let store;
  beforeEach(() => {
    store = createStore({ a: 1 });
  });

  it('get throws on unknown key', () => {
    expect(() => store.get('missing')).toThrow(/Unknown store key/);
  });

  it('set throws on unknown key', () => {
    expect(() => store.set('missing', 42)).toThrow(/Unknown store key/);
  });

  it('update throws on unknown key', () => {
    expect(() => store.update('missing', () => 42)).toThrow(/Unknown store key/);
  });

  it('subscribe throws on unknown key', () => {
    expect(() => store.subscribe('missing', () => {})).toThrow(/Unknown store key/);
  });
});

describe('createStore — set / shallow-equality', () => {
  it('set returns true and notifies when value changes', () => {
    const store = createStore({ a: 1 });
    const spy = vi.fn();
    store.subscribe('a', spy);
    expect(store.set('a', 2)).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(2, 1);
  });

  it('set returns false and does NOT notify when value is identical primitive', () => {
    const store = createStore({ a: 1 });
    const spy = vi.fn();
    store.subscribe('a', spy);
    expect(store.set('a', 1)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('set is a no-op for arrays that are shallow-equal element-wise', () => {
    const store = createStore({ a: [1, 2, 3] });
    const spy = vi.fn();
    store.subscribe('a', spy);
    expect(store.set('a', [1, 2, 3])).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('set notifies when an array element differs', () => {
    const store = createStore({ a: [1, 2, 3] });
    const spy = vi.fn();
    store.subscribe('a', spy);
    expect(store.set('a', [1, 2, 4])).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('set notifies when array length differs', () => {
    const store = createStore({ a: [1, 2, 3] });
    const spy = vi.fn();
    store.subscribe('a', spy);
    expect(store.set('a', [1, 2, 3, 4])).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('set is a no-op for objects with shallow-equal keys', () => {
    const store = createStore({ a: { x: 1, y: 2 } });
    const spy = vi.fn();
    store.subscribe('a', spy);
    expect(store.set('a', { x: 1, y: 2 })).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('set notifies when an object property differs', () => {
    const store = createStore({ a: { x: 1, y: 2 } });
    const spy = vi.fn();
    store.subscribe('a', spy);
    expect(store.set('a', { x: 1, y: 3 })).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('set notifies when object keys differ', () => {
    const store = createStore({ a: { x: 1 } });
    const spy = vi.fn();
    store.subscribe('a', spy);
    expect(store.set('a', { y: 1 })).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('Map values ALWAYS notify, even when handing back the same reference', () => {
    const m = new Map([['k', 'v']]);
    const store = createStore({ a: m });
    const spy = vi.fn();
    store.subscribe('a', spy);
    // Same Map reference — shallowEqual returns false by design.
    expect(store.set('a', m)).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('Set values ALWAYS notify, even when handing back the same reference', () => {
    const s = new Set(['x']);
    const store = createStore({ a: s });
    const spy = vi.fn();
    store.subscribe('a', spy);
    expect(store.set('a', s)).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('switching between an array and an object is a real change', () => {
    const store = createStore({ a: [1, 2] });
    const spy = vi.fn();
    store.subscribe('a', spy);
    expect(store.set('a', { 0: 1, 1: 2 })).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  // Non-plain object instances (Date, RegExp, Error, class instances) have
  // zero enumerable own keys. A naive key-count compare would falsely treat
  // them as shallow-equal and silently no-op. They must always notify when
  // the reference changes.
  it('Date instances with different values trigger notification', () => {
    const store = createStore({ a: new Date(1000) });
    const spy = vi.fn();
    store.subscribe('a', spy);
    expect(store.set('a', new Date(2000))).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('RegExp instances trigger notification when reference changes', () => {
    const store = createStore({ a: /foo/ });
    const spy = vi.fn();
    store.subscribe('a', spy);
    expect(store.set('a', /bar/)).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('Error instances trigger notification when reference changes', () => {
    const store = createStore({ a: new Error('one') });
    const spy = vi.fn();
    store.subscribe('a', spy);
    expect(store.set('a', new Error('two'))).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('class instances with no own keys trigger notification when reference changes', () => {
    class Foo {}
    const store = createStore({ a: new Foo() });
    const spy = vi.fn();
    store.subscribe('a', spy);
    expect(store.set('a', new Foo())).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('same Date reference is still shallow-equal (Object.is short-circuit)', () => {
    const d = new Date(1000);
    const store = createStore({ a: d });
    const spy = vi.fn();
    store.subscribe('a', spy);
    expect(store.set('a', d)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('createStore — update', () => {
  it('update applies the updater and notifies with (next, prev)', () => {
    const store = createStore({ a: 1 });
    const spy = vi.fn();
    store.subscribe('a', spy);
    const changed = store.update('a', (prev) => prev + 1);
    expect(changed).toBe(true);
    expect(store.get('a')).toBe(2);
    expect(spy).toHaveBeenCalledWith(2, 1);
  });

  it('update no-ops when updater returns a shallow-equal value', () => {
    const store = createStore({ a: { x: 1 } });
    const spy = vi.fn();
    store.subscribe('a', spy);
    const changed = store.update('a', () => ({ x: 1 }));
    expect(changed).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('update throws TypeError if updater is not a function', () => {
    const store = createStore({ a: 1 });
    expect(() => store.update('a', 42)).toThrow(TypeError);
    expect(() => store.update('a', null)).toThrow(TypeError);
  });
});

describe('createStore — subscribe / unsubscribe / ordering', () => {
  it('multiple subscribers fire in registration order', () => {
    const store = createStore({ a: 1 });
    const calls = [];
    store.subscribe('a', () => calls.push('first'));
    store.subscribe('a', () => calls.push('second'));
    store.subscribe('a', () => calls.push('third'));
    store.set('a', 2);
    expect(calls).toEqual(['first', 'second', 'third']);
  });

  it('unsubscribe stops further notifications for that subscriber', () => {
    const store = createStore({ a: 1 });
    const spy = vi.fn();
    const off = store.subscribe('a', spy);
    store.set('a', 2);
    expect(spy).toHaveBeenCalledTimes(1);
    off();
    store.set('a', 3);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('subscribe throws TypeError when fn is not a function', () => {
    const store = createStore({ a: 1 });
    expect(() => store.subscribe('a', null)).toThrow(TypeError);
    expect(() => store.subscribe('a', 42)).toThrow(TypeError);
  });

  it('a throwing subscriber does NOT prevent siblings from firing; error is logged', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createStore({ a: 1 });
    const firstFired = vi.fn();
    const thirdFired = vi.fn();
    store.subscribe('a', firstFired);
    store.subscribe('a', () => { throw new Error('boom'); });
    store.subscribe('a', thirdFired);
    store.set('a', 2);
    expect(firstFired).toHaveBeenCalledOnce();
    expect(thirdFired).toHaveBeenCalledOnce();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('createStore — snapshot', () => {
  it('snapshot returns a shallow clone with the current state', () => {
    const store = createStore({ a: 1, b: { x: 1 } });
    const snap = store.snapshot();
    expect(snap).toEqual({ a: 1, b: { x: 1 } });
  });

  it('mutating the snapshot does NOT affect the store', () => {
    const store = createStore({ a: 1 });
    const snap = store.snapshot();
    // Snapshot is frozen; assignment is a no-op in strict mode (throws) or
    // silently ignored. Either way the store's value should be untouched.
    expect(() => { snap.a = 99; }).toThrow();
    expect(store.get('a')).toBe(1);
  });

  it('snapshot reflects subsequent set() calls', () => {
    const store = createStore({ a: 1 });
    store.set('a', 2);
    expect(store.snapshot().a).toBe(2);
  });
});
