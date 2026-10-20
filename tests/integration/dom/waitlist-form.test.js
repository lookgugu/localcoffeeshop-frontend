/**
 * Roaster-subscription interest form (public/waitlist.js + scripts/waitlist-markup.cjs)
 *
 * Inline, accessible, explicit opt-in (unchecked consent), honest pending vs
 * confirmed copy, meaningful errors, one request per submit, and analytics
 * that record attempt / request-accepted — never "confirmed", never a claim
 * that an email was sent (the backend also answers 202 for honeypot and
 * suppressed addresses without sending) — without the address.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import waitlist from '../../../public/waitlist.js';

const require = createRequire(import.meta.url);
const { renderWaitlistSection } = require('../../../scripts/waitlist-markup.cjs');

const EMAIL = 'qa.person@example.com';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function mount(source = 'home', { respond } = {}) {
  document.body.innerHTML = renderWaitlistSection(source);
  const events = [];
  const requests = [];
  const fetchImpl = vi.fn(async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    return respond ? respond(requests.length) : jsonResponse(202, { success: true, data: { status: 'pending_confirmation' } });
  });
  const analytics = { track: (name, params) => events.push([name, params]) };
  const form = document.querySelector('[data-waitlist-form]');
  waitlist.initForm(form, { fetch: fetchImpl, analytics, baseUrl: 'https://api.localcoffeeshop.co/api/v1' });
  return { form, events, requests, fetchImpl };
}

const $ = (sel) => document.querySelector(sel);
const email = () => $('input[name="email"]');
const consent = () => $('input[name="consent"]');
const submit = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('waitlist form markup', () => {
  beforeEach(() => mount());

  it('is an inline form with a labelled email field and an UNCHECKED consent checkbox', () => {
    expect(email().type).toBe('email');
    expect(email().getAttribute('autocomplete')).toBe('email');
    expect($(`label[for="${email().id}"]`).textContent).toMatch(/email/i);
    expect(consent().type).toBe('checkbox');
    expect(consent().checked).toBe(false);
    expect(consent().hasAttribute('checked')).toBe(false);
    expect($(`label[for="${consent().id}"]`).textContent).toMatch(/unsubscribe/i);
  });

  it('explains interest-only, privacy, unsubscribe and support', () => {
    const text = $('.waitlist').textContent;
    expect(text).toMatch(/interest list only/i);
    expect(text).toMatch(/no payment/i);
    expect(text).toMatch(/not on the list until/i);
    expect($('.waitlist a[href="/pages/privacy.html#waitlist"]')).not.toBeNull();
    expect($('.waitlist a[href="/pages/contact.html"]')).not.toBeNull();
  });

  it('the honeypot is hidden from people and assistive tech', () => {
    const hp = $('input[name="company"]');
    expect(hp.getAttribute('tabindex')).toBe('-1');
    expect(hp.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('client-side validation', () => {
  it('empty submit: both errors, aria-invalid, focus on the first, no request', async () => {
    const { form, fetchImpl, events } = mount();
    submit(form);
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(email().getAttribute('aria-invalid')).toBe('true');
    expect(consent().getAttribute('aria-invalid')).toBe('true');
    const emailError = document.getElementById(email().getAttribute('aria-describedby').split(' ')[0]);
    expect(emailError.hidden).toBe(false);
    expect(emailError.textContent).toMatch(/enter your email/i);
    expect(document.activeElement).toBe(email());
    expect(events).toEqual([]);
  });

  it('invalid address and missing consent are explained', async () => {
    const { form, fetchImpl } = mount();
    email().value = 'not-an-email';
    submit(form);
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect($('.waitlist').textContent).toMatch(/valid email address/i);
    expect($('.waitlist').textContent).toMatch(/tick the box/i);
  });

  it('fixing the field clears its error', async () => {
    const { form } = mount();
    submit(form);
    await flush();
    email().value = EMAIL;
    email().dispatchEvent(new Event('input', { bubbles: true }));
    expect(email().hasAttribute('aria-invalid')).toBe(false);
  });
});

describe('submission', () => {
  function fill() {
    email().value = EMAIL;
    consent().checked = true;
  }

  it('posts the bounded body and shows PENDING (not confirmed) success', async () => {
    const { form, requests, events } = mount('roasters');
    fill();
    submit(form);
    expect($('.waitlist-submit').disabled).toBe(true);
    expect(form.getAttribute('aria-busy')).toBe('true');
    await flush();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://api.localcoffeeshop.co/api/v1/waitlist/subscribe');
    expect(requests[0].init.method).toBe('POST');
    expect(requests[0].init.headers['Content-Type']).toBe('application/json');
    expect(requests[0].body).toEqual({ email: EMAIL, consent: true, source: 'roasters', company: '' });

    const success = $('.waitlist-success');
    expect(success.hidden).toBe(false);
    expect(success.textContent).toMatch(/check your inbox/i);
    expect(success.textContent).not.toMatch(/we.ve sent|we sent|has been sent|email sent/i); // a 202 is not a send
    expect(success.textContent).toMatch(/not on the list until/i);
    expect(success.textContent).not.toMatch(/you.re (on the list|confirmed|subscribed)/i);
    expect(document.activeElement).toBe(success);
    expect(form.hidden).toBe(true);
    expect(document.body.innerHTML).not.toContain(EMAIL);

    expect(events).toEqual([
      ['waitlist_signup_attempt', { waitlist_source: 'roasters' }],
      ['waitlist_request_accepted', { waitlist_source: 'roasters' }],
    ]);
    expect(events.map((e) => e[0])).not.toContain('waitlist_confirmed');
    expect(events.map((e) => e[0])).not.toContain('waitlist_signup_accepted');
    expect(JSON.stringify(events)).not.toContain('example.com');
  });

  it('a double submit sends one request', async () => {
    const { form, requests } = mount();
    fill();
    submit(form);
    submit(form);
    await flush();
    expect(requests).toHaveLength(1);
  });

  it('server field errors are mapped to the fields', async () => {
    const { form, events } = mount('home', {
      respond: () => jsonResponse(400, { success: false, error: { code: 'VALIDATION_FAILED', fields: [{ field: 'email', code: 'email_invalid' }] } }),
    });
    fill();
    submit(form);
    await flush();
    expect(email().getAttribute('aria-invalid')).toBe('true');
    expect($('.waitlist').textContent).toMatch(/valid email address/i);
    expect($('.waitlist-submit').disabled).toBe(false);
    expect(events.at(-1)).toEqual(['waitlist_signup_error', { waitlist_source: 'home', error_code: 'validation' }]);
  });

  it.each([
    [429, 'WAITLIST_RATE_LIMITED', /too many/i, 'rate_limited'],
    [503, 'WAITLIST_UNAVAILABLE', /isn.t open/i, 'unavailable'],
    [502, 'WAITLIST_PROVIDER_ERROR', /couldn.t send/i, 'provider'],
    [500, 'WHATEVER', /something went wrong/i, 'unknown'],
  ])('HTTP %s shows a meaningful alert and re-enables the form', async (status, code, message, errorCode) => {
    const { form, events } = mount('home', { respond: () => jsonResponse(status, { success: false, error: { code } }) });
    fill();
    submit(form);
    await flush();
    const alert = $('.waitlist-alert');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.hidden).toBe(false);
    expect(alert.textContent).toMatch(message);
    expect($('.waitlist-submit').disabled).toBe(false);
    expect(form.hasAttribute('aria-busy')).toBe(false);
    expect($('.waitlist-success').hidden).toBe(true);
    expect(email().value).toBe(EMAIL); // kept so the person can retry
    expect(events.at(-1)).toEqual(['waitlist_signup_error', { waitlist_source: 'home', error_code: errorCode }]);
  });

  it('a network failure is reported as such', async () => {
    const { form, events } = mount('home', { respond: () => { throw new TypeError('Failed to fetch'); } });
    fill();
    submit(form);
    await flush();
    expect($('.waitlist-alert').textContent).toMatch(/couldn.t reach/i);
    expect(events.at(-1)[1].error_code).toBe('network');
  });

  it('an unexpected 2xx body is not treated as success', async () => {
    const { form } = mount('home', { respond: () => jsonResponse(200, { success: true, data: { status: 'confirmed' } }) });
    fill();
    submit(form);
    await flush();
    expect($('.waitlist-success').hidden).toBe(true);
    expect($('.waitlist-alert').hidden).toBe(false);
  });

  it('sends the honeypot as typed (the server decides)', async () => {
    const { form, requests } = mount();
    fill();
    $('input[name="company"]').value = 'bot co';
    submit(form);
    await flush();
    expect(requests[0].body.company).toBe('bot co');
  });

  it('works without analytics', async () => {
    document.body.innerHTML = renderWaitlistSection('home');
    const form = document.querySelector('[data-waitlist-form]');
    waitlist.initForm(form, { fetch: async () => jsonResponse(202, { success: true, data: { status: 'pending_confirmation' } }), analytics: null, baseUrl: '/api/v1' });
    fill();
    submit(form);
    await flush();
    expect($('.waitlist-success').hidden).toBe(false);
  });
});

describe('apiBase', () => {
  it('uses APP_CONFIG and strips a trailing slash', () => {
    expect(waitlist.apiBase({ APP_CONFIG: { API_BASE_URL: 'https://api.localcoffeeshop.co/api/v1/' } })).toBe('https://api.localcoffeeshop.co/api/v1');
    expect(waitlist.apiBase({})).toBe('/api/v1');
  });
});
