/**
 * Privacy-safe custom events (public/analytics-events.js)
 *
 * Only allowlisted event names with allowlisted categorical / count / id
 * parameters reach gtag, always with an explicit send_to. Anything else —
 * raw search text, emails, tokens, unknown keys — is dropped.
 */

import { describe, it, expect, vi } from 'vitest';
import analytics from '../../public/analytics-events.js';

function makeWin() {
  const calls = [];
  return { calls, win: { gtag: (...args) => calls.push(args) } };
}

describe('track', () => {
  it('sends allowlisted params with explicit send_to', () => {
    const { win, calls } = makeWin();
    const sent = analytics.track('directory_search', {
      search_has_query: 'yes', search_state: 'CA', search_price: 'PRICE_LEVEL_MODERATE', result_count: 12,
    }, win);
    expect(calls).toEqual([['event', 'directory_search', {
      search_has_query: 'yes', search_state: 'CA', search_price: 'moderate', result_count: 12, send_to: 'G-YVSXN7PM48',
    }]]);
    expect(sent).toBeTruthy();
  });

  it('drops unknown keys and invalid values (raw query, emails, tokens)', () => {
    const { win, calls } = makeWin();
    analytics.track('directory_search', {
      search_has_query: 'Secret Latte', search_term: 'Secret Latte', q: 'x', email: 'p@example.com',
      search_state: 'California', search_price: 'cheap', result_count: -1, token: 'v1.abc',
    }, win);
    expect(calls[0][2]).toEqual({ send_to: 'G-YVSXN7PM48' });
  });

  it('has no custom bean-store click or provider-accepted event: GA enhanced outbound click is the one canonical click, and a 202 is only a request accepted', () => {
    const { win, calls } = makeWin();
    expect(analytics.track('bean_store_click', { roaster_id: 'x', link_type: 'shop' }, win)).toBe(false);
    expect(analytics.track('waitlist_signup_accepted', { waitlist_source: 'home' }, win)).toBe(false);
    expect(Object.keys(analytics.SCHEMAS)).not.toContain('bean_store_click');
    expect(Object.keys(analytics.SCHEMAS)).not.toContain('waitlist_signup_accepted');
    expect(Object.keys(analytics.SCHEMAS)).toContain('waitlist_request_accepted');
    expect(calls).toHaveLength(0);
  });

  it('ignores event names outside the allowlist', () => {
    const { win, calls } = makeWin();
    expect(analytics.track('search', { search_term: 'x' }, win)).toBe(false);
    expect(analytics.track('page_view', {}, win)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['roaster_filter', { filter_has_query: 'no', filter_state: 'all', result_count: 18 }],
    ['waitlist_signup_attempt', { waitlist_source: 'home' }],
    ['waitlist_request_accepted', { waitlist_source: 'roasters' }],
    ['waitlist_signup_error', { waitlist_source: 'home', error_code: 'rate_limited' }],
    ['waitlist_confirmed', { confirm_result: 'confirmed' }],
  ])('%s passes its allowlisted params', (name, params) => {
    const { win, calls } = makeWin();
    analytics.track(name, params, win);
    expect(calls[0][2]).toEqual({ ...params, send_to: 'G-YVSXN7PM48' });
  });

  it('rejects ids that are not slug-shaped and unknown error codes', () => {
    const { win, calls } = makeWin();
    analytics.track('waitlist_signup_error', { waitlist_source: 'popup', error_code: 'p@example.com' }, win);
    analytics.track('waitlist_confirmed', { confirm_result: 'already_confirmed' }, win);
    expect(calls.map((c) => c[2])).toEqual([{ send_to: 'G-YVSXN7PM48' }, { send_to: 'G-YVSXN7PM48' }]);
  });

  it('falls back to the dataLayer when gtag is not global, and no-ops without either', () => {
    const win = { dataLayer: [] };
    analytics.track('waitlist_signup_attempt', { waitlist_source: 'home' }, win);
    expect(Array.from(win.dataLayer[0])).toEqual(['event', 'waitlist_signup_attempt', { waitlist_source: 'home', send_to: 'G-YVSXN7PM48' }]);
    expect(analytics.track('waitlist_signup_attempt', { waitlist_source: 'home' }, {})).toBe(false);
  });

  it('never throws if gtag throws', () => {
    const win = { gtag: vi.fn(() => { throw new Error('blocked'); }) };
    expect(() => analytics.track('waitlist_signup_attempt', { waitlist_source: 'home' }, win)).not.toThrow();
  });
});
