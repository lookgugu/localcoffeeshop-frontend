/**
 * Unit Tests: LruMap
 *
 * Covers the contract spelled out in tasks/todo.md candidate #5:
 *   - Positive integer maxSize required (throws on 0, negative, non-integer)
 *   - get / set / has / size / delete / clear behave like Map
 *   - Insertion past maxSize evicts the oldest key
 *   - get bumps recency — the touched key survives eviction
 *   - Iteration order reflects recency (oldest first)
 *
 * UMD-style: default import gives us the module's exported object.
 */

import { describe, it, expect } from 'vitest';
import LruMapModule from '../../../public/lib/lru-map.js';

const { LruMap } = LruMapModule;

describe('LruMap — construction', () => {
  it('throws TypeError on maxSize = 0', () => {
    expect(() => new LruMap(0)).toThrow(TypeError);
  });

  it('throws TypeError on negative maxSize', () => {
    expect(() => new LruMap(-1)).toThrow(TypeError);
  });

  it('throws TypeError on non-integer maxSize', () => {
    expect(() => new LruMap(1.5)).toThrow(TypeError);
    expect(() => new LruMap('10')).toThrow(TypeError);
    expect(() => new LruMap(NaN)).toThrow(TypeError);
    expect(() => new LruMap(undefined)).toThrow(TypeError);
  });

  it('accepts a positive integer maxSize', () => {
    const m = new LruMap(3);
    expect(m.size).toBe(0);
  });
});

describe('LruMap — basic Map operations', () => {
  it('set then get returns the value', () => {
    const m = new LruMap(3);
    m.set('a', 1);
    expect(m.get('a')).toBe(1);
  });

  it('get returns undefined for missing keys', () => {
    const m = new LruMap(3);
    expect(m.get('missing')).toBeUndefined();
  });

  it('has reports membership accurately', () => {
    const m = new LruMap(3);
    m.set('a', 1);
    expect(m.has('a')).toBe(true);
    expect(m.has('b')).toBe(false);
  });

  it('size reflects current entry count', () => {
    const m = new LruMap(3);
    expect(m.size).toBe(0);
    m.set('a', 1);
    expect(m.size).toBe(1);
    m.set('b', 2);
    expect(m.size).toBe(2);
  });

  it('delete removes a key and returns true; false when absent', () => {
    const m = new LruMap(3);
    m.set('a', 1);
    expect(m.delete('a')).toBe(true);
    expect(m.has('a')).toBe(false);
    expect(m.delete('a')).toBe(false);
  });

  it('clear empties the map', () => {
    const m = new LruMap(3);
    m.set('a', 1);
    m.set('b', 2);
    m.clear();
    expect(m.size).toBe(0);
    expect(m.has('a')).toBe(false);
  });

  it('overwriting an existing key keeps size constant', () => {
    const m = new LruMap(3);
    m.set('a', 1);
    m.set('a', 2);
    expect(m.size).toBe(1);
    expect(m.get('a')).toBe(2);
  });
});

describe('LruMap — eviction', () => {
  it('evicts the oldest key when set would exceed maxSize', () => {
    const m = new LruMap(3);
    m.set('a', 1);
    m.set('b', 2);
    m.set('c', 3);
    m.set('d', 4); // evicts 'a'
    expect(m.size).toBe(3);
    expect(m.has('a')).toBe(false);
    expect(m.has('b')).toBe(true);
    expect(m.has('c')).toBe(true);
    expect(m.has('d')).toBe(true);
  });

  it('get bumps recency — gotten key survives a subsequent eviction', () => {
    const m = new LruMap(3);
    m.set('a', 1);
    m.set('b', 2);
    m.set('c', 3);
    // Touch 'a' so it becomes the most-recently-used.
    m.get('a');
    m.set('d', 4); // evicts 'b' (now the oldest), NOT 'a'
    expect(m.has('a')).toBe(true);
    expect(m.has('b')).toBe(false);
    expect(m.has('c')).toBe(true);
    expect(m.has('d')).toBe(true);
  });

  it('overwriting an existing key bumps its recency', () => {
    const m = new LruMap(3);
    m.set('a', 1);
    m.set('b', 2);
    m.set('c', 3);
    m.set('a', 99); // re-insert 'a' as most-recent
    m.set('d', 4);  // evicts 'b'
    expect(m.has('a')).toBe(true);
    expect(m.has('b')).toBe(false);
  });
});

describe('LruMap — iteration order', () => {
  it('keys() yields oldest-first by recency', () => {
    const m = new LruMap(3);
    m.set('a', 1);
    m.set('b', 2);
    m.set('c', 3);
    expect([...m.keys()]).toEqual(['a', 'b', 'c']);
    m.get('a'); // 'a' is now most-recent → order becomes b, c, a
    expect([...m.keys()]).toEqual(['b', 'c', 'a']);
  });

  it('[Symbol.iterator] yields [key, value] entries in recency order', () => {
    const m = new LruMap(3);
    m.set('a', 1);
    m.set('b', 2);
    expect([...m]).toEqual([['a', 1], ['b', 2]]);
  });

  it('entries() and values() reflect recency order', () => {
    const m = new LruMap(3);
    m.set('a', 1);
    m.set('b', 2);
    m.get('a');
    expect([...m.entries()]).toEqual([['b', 2], ['a', 1]]);
    expect([...m.values()]).toEqual([2, 1]);
  });
});
