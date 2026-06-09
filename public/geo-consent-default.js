(function () {
  'use strict';

  var STRICT_TIME_ZONE_PREFIXES = [
    'Europe/',
    'Atlantic/Azores',
    'Atlantic/Canary',
    'Atlantic/Faroe',
    'Atlantic/Madeira'
  ];
  var STRICT_TIME_ZONES = [
    'UTC',
    'Etc/UTC',
    'Etc/GMT',
    'America/Los_Angeles'
  ];
  var STRICT_LANGUAGE_REGIONS = [
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE',
    'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT',
    'RO', 'SK', 'SI', 'ES', 'SE', 'GB', 'UK', 'IS', 'LI', 'NO', 'CH'
  ];

  function getTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) {
      return '';
    }
  }

  function getLanguages() {
    var langs = [];
    if (Array.isArray(navigator.languages)) langs = langs.concat(navigator.languages);
    if (navigator.language) langs.push(navigator.language);
    return langs.filter(Boolean);
  }

  function hasStrictLanguageRegion() {
    return getLanguages().some(function (language) {
      var match = String(language).toUpperCase().match(/[-_]([A-Z]{2})$/);
      return match && STRICT_LANGUAGE_REGIONS.indexOf(match[1]) !== -1;
    });
  }

  function isStrictConsentRegion() {
    var timeZone = getTimeZone();
    if (STRICT_TIME_ZONES.indexOf(timeZone) !== -1) return true;
    if (STRICT_TIME_ZONE_PREFIXES.some(function (prefix) { return timeZone.indexOf(prefix) === 0; })) return true;
    return hasStrictLanguageRegion();
  }

  function deniedConsentState() {
    return {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      functionality_storage: 'granted',
      security_storage: 'granted',
      wait_for_update: 500
    };
  }

  function getDefaultConsentState() {
    var strict = isStrictConsentRegion();
    var state = deniedConsentState();
    state.analytics_storage = strict ? 'denied' : 'granted';
    return state;
  }

  var CONSENT_KEYS = [
    'analytics_storage',
    'ad_storage',
    'ad_user_data',
    'ad_personalization',
    'functionality_storage',
    'security_storage'
  ];

  function normalizeConsentState(consent) {
    if (!consent || typeof consent !== 'object') return null;
    var normalized = deniedConsentState();
    for (var i = 0; i < CONSENT_KEYS.length; i += 1) {
      var key = CONSENT_KEYS[i];
      var value = consent[key];
      if (value !== 'granted' && value !== 'denied') return null;
      normalized[key] = value;
    }
    return normalized;
  }

  function loadSavedConsent() {
    try {
      var raw = localStorage.getItem('cookie_consent');
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.version === '1.0') return normalizeConsentState(parsed.consent);
    } catch (e) {
      return null;
    }
    return null;
  }

  function getInitialConsentState() {
    return loadSavedConsent() || getDefaultConsentState();
  }

  window.LocalCoffeeShopConsent = {
    isStrictConsentRegion: isStrictConsentRegion,
    getDefaultConsentState: getDefaultConsentState,
    normalizeConsentState: normalizeConsentState,
    getInitialConsentState: getInitialConsentState,
    deniedConsentState: deniedConsentState
  };
})();
