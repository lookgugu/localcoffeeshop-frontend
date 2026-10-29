/**
 * URL privacy (public/url-privacy.js)
 *
 * Runs as a blocking script before the Google tag is configured, so the page
 * URL GA reads (page_location, and page_referrer on the next page) never
 * carries raw search text, an email address or a waitlist token. The values
 * the page needs are handed over in memory, one time only.
 */

import { describe, it, expect, vi } from 'vitest';
import privacy from '../../public/url-privacy.js';

describe('sanitize', () => {
  it.each([
    ['/?q=Secret+Latte', '/', { q: 'Secret Latte', token: null }],
    ['/?q=latte&state=CA&price=PRICE_LEVEL_MODERATE', '/?state=CA&price=PRICE_LEVEL_MODERATE', { q: 'latte', token: null }],
    ['/roasters/?state=MA&q=bean#roaster-acme', '/roasters/?state=MA#roaster-acme', { q: 'bean', token: null }],
    ['/?search=x&s=y&query=z&keyword=k&term=t', '/', { q: 'x', token: null }],
    ['/?email=a%40b.com&utm_source=news', '/?utm_source=news', { q: null, token: null }],
    ['/?utm_content=person%40example.com&state=TX', '/?state=TX', { q: null, token: null }],
    ['/waitlist/confirm/#token=v1.abc_DEF-1', '/waitlist/confirm/', { q: null, token: 'v1.abc_DEF-1' }],
    ['/waitlist/confirm/?token=v1.abc', '/waitlist/confirm/', { q: null, token: 'v1.abc' }],
    ['/x#contact=me@example.com', '/x', { q: null, token: null }],
    ['/html/state.html?code=CA', '/html/state.html?code=CA', { q: null, token: null }],
    // case-insensitive keys and fragments, and empty-token variants
    ['/waitlist/confirm/#TOKEN=v1.secret', '/waitlist/confirm/', { q: null, token: 'v1.secret' }],
    ['/waitlist/confirm/#token=', '/waitlist/confirm/', { q: null, token: null }],
    ['/waitlist/confirm/?token=', '/waitlist/confirm/', { q: null, token: null }],
    ['/waitlist/confirm/?TOKEN=v1.abc', '/waitlist/confirm/', { q: null, token: 'v1.abc' }],
    ['/?Q=Secret&EMAIL=a%40b.com&State=CA', '/?State=CA', { q: 'Secret', token: null }],
    ['/x#Q=Secret+Latte', '/x', { q: null, token: null }],
    ['/x?next=/?q%3Dsecret', '/x', { q: null, token: null }],
    ['/x?a=1;token=y', '/x', { q: null, token: null }],
  ])('%s → %s', (input, clean, captured) => {
    const out = privacy.sanitize(`https://localcoffeeshop.co${input}`);
    expect(out.clean).toBe(clean);
    expect(out.captured).toEqual(captured);
  });

  it('caps captured values', () => {
    const out = privacy.sanitize(`https://x.test/?q=${'a'.repeat(500)}`);
    expect(out.captured.q).toHaveLength(100);
  });

  it('pageLocation returns an absolute sanitised URL', () => {
    expect(privacy.pageLocation('https://localcoffeeshop.co/?q=x&state=CA#token=v1.a')).toBe('https://localcoffeeshop.co/?state=CA');
  });
});

describe('scrub', () => {
  function fakeWindow(href) {
    const win = {
      location: new URL(href),
      history: { state: { keep: 1 }, replaceState: vi.fn((state, _t, url) => { win.location = new URL(url, win.location.href); }) },
    };
    return win;
  }

  it('rewrites the address bar once, keeping history state, and hands values over once', () => {
    const win = fakeWindow('https://localcoffeeshop.co/waitlist/confirm/?utm_source=email#token=v1.tok');
    const api = privacy.scrub(win);
    expect(win.history.replaceState).toHaveBeenCalledTimes(1);
    expect(win.history.replaceState.mock.calls[0][0]).toEqual({ keep: 1 });
    expect(win.location.href).toBe('https://localcoffeeshop.co/waitlist/confirm/?utm_source=email');
    expect(api.takeToken()).toBe('v1.tok');
    expect(api.takeToken()).toBeNull();
  });

  it('does not touch a clean URL', () => {
    const win = fakeWindow('https://localcoffeeshop.co/?state=CA');
    const api = privacy.scrub(win);
    expect(win.history.replaceState).not.toHaveBeenCalled();
    expect(api.takeInitialQuery()).toBeNull();
  });

  it('hands the initial search query over once', () => {
    const api = privacy.scrub(fakeWindow('https://localcoffeeshop.co/?q=flat+white'));
    expect(api.takeInitialQuery()).toBe('flat white');
    expect(api.takeInitialQuery()).toBeNull();
  });

  it('survives a browser without history.replaceState', () => {
    const win = { location: new URL('https://x.test/?q=a') };
    expect(() => privacy.scrub(win)).not.toThrow();
  });
});


describe('pageLocation / safeReferrer (what the Google tag is allowed to see)', () => {
  const SECRETS = /QA_PRIVATE|qa\.private|qa%40|PRIVATE_TOKEN|secret|latte|token/i;

  it.each([
    ['http://127.0.0.1:8189/?q=QA_PRIVATE_REFERRER&email=qa.private%40example.com', 'http://127.0.0.1:8189/'],
    ['http://127.0.0.1:8189/?Q=QA_PRIVATE&EMAIL=qa.private%40example.com&TOKEN=PRIVATE_TOKEN', 'http://127.0.0.1:8189/'],
    ['https://localcoffeeshop.co/?state=CA&q=Secret+Latte', 'https://localcoffeeshop.co/?state=CA'],
    ['https://localcoffeeshop.co/waitlist/confirm/#token=PRIVATE_TOKEN', 'https://localcoffeeshop.co/waitlist/confirm/'],
    ['https://localcoffeeshop.co/waitlist/confirm/#token=', 'https://localcoffeeshop.co/waitlist/confirm/'],
    ['https://localcoffeeshop.co/waitlist/confirm/?token=', 'https://localcoffeeshop.co/waitlist/confirm/'],
    ['https://localcoffeeshop.co/html/state.html?code=CA&q=Secret', 'https://localcoffeeshop.co/html/state.html?code=CA'],
    ['https://localcoffeeshop.co/me@example.com', 'https://localcoffeeshop.co/redacted'],
    ['https://localcoffeeshop.co/a/token=PRIVATE_TOKEN', 'https://localcoffeeshop.co/a/redacted'],
    ['https://user:pw@localcoffeeshop.co/?q=Secret', 'https://localcoffeeshop.co/'],
  ])('referrer %s → %s', (referrer, expected) => {
    const out = privacy.safeReferrer(referrer);
    expect(out).toBe(expected);
    expect(out).not.toMatch(SECRETS);
  });

  it.each([
    [''], [undefined], [null], ['not a url'], ['http://[::1'], ['javascript:alert(1)'], ['data:text/html,q=Secret'],
    ['file:///tmp/?q=Secret'], ['//localcoffeeshop.co/?q=Secret'], ['https://'],
  ])('malformed or non-http(s) referrer %j is reduced to nothing (fail closed)', (referrer) => {
    expect(privacy.safeReferrer(referrer)).toBe('');
  });

  it('pageLocation throws on an unparseable URL instead of returning it raw', () => {
    expect(() => privacy.pageLocation('not a url')).toThrow();
  });
});

describe('analyticsFields (fed to the first gtag config)', () => {
  function fakeWindow(href, referrer) {
    const win = {
      location: new URL(href),
      document: { referrer },
      history: { state: null, replaceState: vi.fn((s, _t, url) => { win.location = new URL(url, win.location.href); }) },
    };
    return win;
  }

  it.each([
    ['https://localcoffeeshop.co/?q=Secret+Latte&state=CA', 'https://localcoffeeshop.co/?q=QA_PRIVATE&email=a%40b.com', 'https://localcoffeeshop.co/?state=CA', 'https://localcoffeeshop.co/'],
    ['https://localcoffeeshop.co/waitlist/confirm/#token=v2.PRIVATE_TOKEN', '', 'https://localcoffeeshop.co/waitlist/confirm/', ''],
    ['https://localcoffeeshop.co/html/state.html?code=CA&email=a%40b.com', 'https://news.example/?q=x', 'https://localcoffeeshop.co/html/state.html?code=CA', 'https://news.example/'],
    ['https://localcoffeeshop.co/html/404.html?q=Secret', 'https://localcoffeeshop.co/?token=PRIVATE_TOKEN', 'https://localcoffeeshop.co/html/404.html', 'https://localcoffeeshop.co/'],
  ])('%s with referrer %s', (href, referrer, location, ref) => {
    const fields = privacy.scrub(fakeWindow(href, referrer)).analyticsFields();
    expect(fields).toEqual({ page_location: location, page_referrer: ref });
  });

  it('returns null (so the tag is not configured) when the location or referrer cannot be read', () => {
    const noLocation = { history: {} };
    expect(privacy.scrub(noLocation).analyticsFields()).toBeNull();
    const win = fakeWindow('https://localcoffeeshop.co/', '');
    Object.defineProperty(win.document, 'referrer', { get() { throw new Error('blocked'); } });
    expect(privacy.scrub(win).analyticsFields()).toBeNull();
  });

  it('the initial q and token are still handed to the app in memory', () => {
    const api = privacy.scrub(fakeWindow('https://localcoffeeshop.co/?Q=Secret+Latte#TOKEN=v2.abc', ''));
    expect(api.takeInitialQuery()).toBe('Secret Latte');
    expect(api.takeToken()).toBe('v2.abc');
  });
});
