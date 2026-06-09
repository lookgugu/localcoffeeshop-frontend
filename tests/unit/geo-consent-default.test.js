import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const source = readFileSync(resolve(process.cwd(), 'public/geo-consent-default.js'), 'utf8');

function loadConsent({ timeZone, languages = ['en-US'], language = languages[0], savedConsent = null } = {}) {
  const storage = savedConsent
    ? { cookie_consent: JSON.stringify(savedConsent) }
    : {};
  const sandbox = {
    window: {},
    navigator: { languages, language },
    localStorage: {
      getItem: (key) => storage[key] || null,
      setItem: (key, value) => { storage[key] = value; },
      removeItem: (key) => { delete storage[key]; }
    },
    Intl: {
      DateTimeFormat: () => ({
        resolvedOptions: () => ({ timeZone })
      })
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  return sandbox.LocalCoffeeShopConsent;
}

describe('geo consent defaults', () => {
  beforeEach(() => {
    delete globalThis.LocalCoffeeShopConsent;
  });

  it('grants analytics by default for ordinary US visitors while denying ad storage', () => {
    const consent = loadConsent({ timeZone: 'America/New_York', languages: ['en-US'] });
    const state = consent.getDefaultConsentState();

    expect(consent.isStrictConsentRegion()).toBe(false);
    expect(state.analytics_storage).toBe('granted');
    expect(state.ad_storage).toBe('denied');
    expect(state.ad_user_data).toBe('denied');
    expect(state.ad_personalization).toBe('denied');
  });

  it('denies analytics by default for Europe/UK style regions', () => {
    const consent = loadConsent({ timeZone: 'Europe/London', languages: ['en-GB'] });
    const state = consent.getDefaultConsentState();

    expect(consent.isStrictConsentRegion()).toBe(true);
    expect(state.analytics_storage).toBe('denied');
    expect(state.ad_storage).toBe('denied');
  });

  it('denies analytics by default for California timezone as a conservative CCPA signal', () => {
    const consent = loadConsent({ timeZone: 'America/Los_Angeles', languages: ['en-US'] });
    const state = consent.getDefaultConsentState();

    expect(consent.isStrictConsentRegion()).toBe(true);
    expect(state.analytics_storage).toBe('denied');
  });

  it('uses saved reject consent before the first GA config in non-strict regions', () => {
    const savedReject = {
      version: '1.0',
      consent: {
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        functionality_storage: 'granted',
        security_storage: 'granted'
      }
    };
    const consent = loadConsent({ timeZone: 'America/New_York', languages: ['en-US'], savedConsent: savedReject });

    expect(consent.getDefaultConsentState().analytics_storage).toBe('granted');
    expect(consent.getInitialConsentState().analytics_storage).toBe('denied');
  });

  it('uses saved accept consent before the first GA config in strict regions', () => {
    const savedAccept = {
      version: '1.0',
      consent: {
        analytics_storage: 'granted',
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted',
        functionality_storage: 'granted',
        security_storage: 'granted'
      }
    };
    const consent = loadConsent({ timeZone: 'Europe/Paris', languages: ['fr-FR'], savedConsent: savedAccept });

    expect(consent.getDefaultConsentState().analytics_storage).toBe('denied');
    expect(consent.getInitialConsentState().analytics_storage).toBe('granted');
  });

  it('ignores malformed saved consent and falls back to the geo default', () => {
    const malformed = {
      version: '1.0',
      consent: {
        analytics_storage: 'granted'
      }
    };
    const consent = loadConsent({ timeZone: 'Europe/Paris', languages: ['fr-FR'], savedConsent: malformed });

    expect(consent.normalizeConsentState(malformed.consent)).toBeNull();
    expect(consent.getInitialConsentState().analytics_storage).toBe('denied');
  });

  it('ignores invalid saved consent values', () => {
    const malformed = {
      version: '1.0',
      consent: {
        analytics_storage: 'banana',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        functionality_storage: 'granted',
        security_storage: 'granted'
      }
    };
    const consent = loadConsent({ timeZone: 'America/New_York', languages: ['en-US'], savedConsent: malformed });

    expect(consent.normalizeConsentState(malformed.consent)).toBeNull();
    expect(consent.getInitialConsentState().analytics_storage).toBe('granted');
  });
});
