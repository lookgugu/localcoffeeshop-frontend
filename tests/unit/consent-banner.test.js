/**
 * Consent banner (public/consent-banner.js) with Google Consent Mode:
 * live Reject All / Accept All, saved consent, and no URL passthrough.
 * The banner must also never steal focus from a form someone is using.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const KEYS = ['analytics_storage', 'ad_storage', 'ad_user_data', 'ad_personalization'];
const entries = () => window.dataLayer.map((a) => Array.from(a));

async function load({ saved = null, readyState = 'complete' } = {}) {
  vi.resetModules();
  localStorage.clear();
  if (saved) localStorage.setItem('cookie_consent', JSON.stringify({ version: '1.0', consent: saved }));
  document.body.innerHTML = '<main><form><input id="email" type="email"></form></main>';
  delete window.gtag;
  window.dataLayer = [];
  Object.defineProperty(document, 'readyState', { configurable: true, value: readyState });
  await import('../../public/consent-banner.js');
}

const state = (analytics, ads = analytics) => ({
  analytics_storage: analytics, ad_storage: ads, ad_user_data: ads, ad_personalization: ads,
  functionality_storage: 'granted', security_storage: 'granted',
});

describe('consent banner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    delete window.CookieConsent;
    delete window.showConsentBanner;
  });

  it('does not enable url_passthrough', async () => {
    await load();
    expect(entries().some((e) => e[0] === 'set' && e[1] === 'url_passthrough')).toBe(false);
    expect(entries().some((e) => e[0] === 'set' && e[1] === 'ads_data_redaction' && e[2] === true)).toBe(true);
  });

  it('live Reject All sends a denied consent update and saves it', async () => {
    await load();
    vi.advanceTimersByTime(1000);
    document.getElementById('consent-reject').click();
    const update = entries().find((e) => e[0] === 'consent' && e[1] === 'update');
    expect(update[2]).toEqual(state('denied'));
    expect(JSON.parse(localStorage.getItem('cookie_consent')).consent).toEqual(state('denied'));
  });

  it('live Accept All grants analytics and ads', async () => {
    await load();
    document.getElementById('consent-accept').click();
    expect(entries().find((e) => e[0] === 'consent' && e[1] === 'update')[2]).toEqual(state('granted'));
  });

  it('saved reject is applied immediately with no banner', async () => {
    await load({ saved: state('denied') });
    expect(document.getElementById('consent-banner')).toBeNull();
    const update = entries().find((e) => e[0] === 'consent' && e[1] === 'update');
    expect(KEYS.every((k) => update[2][k] === 'denied')).toBe(true);
  });

  it('keeps focus where the person is typing; takes it only when nothing is focused', async () => {
    await load();
    const email = document.getElementById('email');
    email.focus();
    vi.advanceTimersByTime(1000 + 500 + 50);
    expect(document.activeElement).toBe(email);

    await load();
    expect(document.activeElement).toBe(document.body);
    vi.advanceTimersByTime(1000 + 500 + 50);
    expect(document.activeElement).toBe(document.getElementById('consent-accept'));
  });
});
