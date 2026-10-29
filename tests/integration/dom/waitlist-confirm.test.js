/**
 * Waitlist confirm / unsubscribe pages (public/waitlist/{confirm,unsubscribe}/index.html)
 *
 * Opening the link changes nothing: the token (from the URL fragment, already
 * scrubbed from the address bar by url-privacy.js) is held in memory, and
 * only pressing the button POSTs it. "Confirmed" analytics fires once, only
 * for the backend's `confirmed` result — never on page visit or replay.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import waitlist from '../../../public/waitlist.js';

const PUBLIC = resolve(__dirname, '../../../public');
const TOKEN = 'v2.abcDEF_123-xyz';

function body(page) {
  const html = readFileSync(join(PUBLIC, 'waitlist', page, 'index.html'), 'utf8');
  return html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
}

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function mount(page, { token = TOKEN, responses = [] } = {}) {
  document.body.innerHTML = body(page);
  const events = [];
  const requests = [];
  const fetchImpl = vi.fn(async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body), method: init.method });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const deps = {
    fetch: fetchImpl,
    analytics: { track: (name, params) => events.push([name, params]) },
    baseUrl: '/api/v1',
    token,
  };
  const init = page === 'confirm' ? waitlist.initConfirmPage : waitlist.initUnsubscribePage;
  init(document, deps);
  return { events, requests, fetchImpl };
}

const $ = (sel) => document.querySelector(sel);
const flush = () => new Promise((r) => setTimeout(r, 0));
const ok = (status, conversion = 'none') => jsonResponse(200, { success: true, data: { status, conversion } });
const fail = (status, code) => jsonResponse(status, { success: false, error: { code } });

describe('confirm page', () => {
  it('does nothing on load: no request, no event', async () => {
    const { fetchImpl, events } = mount('confirm');
    await flush();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect($('[data-action="confirm"]').disabled).toBe(false);
  });

  it('pressing the button POSTs the token and reports an observed new confirmation once', async () => {
    const { requests, events } = mount('confirm', { responses: [ok('confirmed', 'observed_new')] });
    $('[data-action="confirm"]').click();
    $('[data-action="confirm"]').click(); // double click
    await flush();
    expect(requests).toEqual([{ url: '/api/v1/waitlist/confirm', body: { token: TOKEN }, method: 'POST' }]);
    expect($('[data-status]').textContent).toMatch(/you.re on the interest list/i);
    expect($('[data-status]').textContent).toMatch(/unsubscribe/i);
    expect($('[data-action="confirm"]').hidden).toBe(true);
    expect(events).toEqual([['waitlist_confirmed', { confirm_result: 'confirmed' }]]);
  });

  it('confirmed but ambiguous: normal success UI, no conversion event', async () => {
    const { events } = mount('confirm', { responses: [ok('confirmed', 'ambiguous')] });
    $('[data-action="confirm"]').click();
    await flush();
    expect($('[data-status]').textContent).toMatch(/you.re on the interest list/i);
    expect(events).toEqual([]);
  });

  it('confirmed without a conversion field is not counted (conservative)', async () => {
    const { events } = mount('confirm', { responses: [jsonResponse(200, { success: true, data: { status: 'confirmed' } })] });
    $('[data-action="confirm"]').click();
    await flush();
    expect($('[data-status]').textContent).toMatch(/you.re on the interest list/i);
    expect(events).toEqual([]);
  });

  it('suppressed (unsubscribed from this list) is respected, not an error, not counted', async () => {
    const { events } = mount('confirm', { responses: [ok('suppressed')] });
    $('[data-action="confirm"]').click();
    await flush();
    expect($('[data-status]').textContent).toMatch(/unsubscribed from the roaster interest list.*didn.t add it again/i);
    expect($('[data-status] a[href="/pages/contact.html"]')).not.toBeNull();
    expect($('[data-alert]').hidden).toBe(true);
    expect(events).toEqual([]);
  });

  it('an unknown status is not shown as success', async () => {
    const { events } = mount('confirm', { responses: [ok('something_new')] });
    $('[data-action="confirm"]').click();
    await flush();
    expect($('[data-alert]').hidden).toBe(false);
    expect(events).toEqual([]);
  });

  it('a replay (already_confirmed) is not counted as a confirmation', async () => {
    const { events } = mount('confirm', { responses: [ok('already_confirmed')] });
    $('[data-action="confirm"]').click();
    await flush();
    expect($('[data-status]').textContent).toMatch(/already on the interest list/i);
    expect(events).toEqual([]);
  });

  it('a globally unsubscribed address is told it was not added', async () => {
    const { events } = mount('confirm', { responses: [ok('unsubscribed_globally')] });
    $('[data-action="confirm"]').click();
    await flush();
    expect($('[data-status]').textContent).toMatch(/haven.t added/i);
    expect($('[data-status] a[href="/pages/contact.html"]')).not.toBeNull();
    expect(events).toEqual([]);
  });

  it.each([
    [fail(410, 'WAITLIST_TOKEN_EXPIRED'), /expired/i, false],
    [fail(400, 'WAITLIST_TOKEN_INVALID'), /isn.t valid/i, false],
    [fail(503, 'WAITLIST_UNAVAILABLE'), /try again/i, true],
    [fail(502, 'WAITLIST_PROVIDER_ERROR'), /try again/i, true],
    [new TypeError('Failed to fetch'), /couldn.t reach/i, true],
  ])('errors are explained (%#) and retry is offered only when it can help', async (response, message, retryable) => {
    const { events } = mount('confirm', { responses: [response] });
    $('[data-action="confirm"]').click();
    await flush();
    const alert = $('[data-alert]');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.hidden).toBe(false);
    expect(alert.textContent).toMatch(message);
    const button = $('[data-action="confirm"]');
    expect(!button.hidden && !button.disabled).toBe(retryable);
    expect(events).toEqual([]);
  });

  it('without a token the page says the link is incomplete and offers no button', () => {
    const { fetchImpl } = mount('confirm', { token: null });
    expect($('[data-alert]').textContent).toMatch(/incomplete/i);
    expect($('[data-action="confirm"]').hidden).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('terminal results move focus off the hidden button', () => {
  it.each([
    ['confirmed', () => ok('confirmed', 'observed_new'), '[data-status]'],
    ['already_confirmed', () => ok('already_confirmed'), '[data-status]'],
    ['suppressed', () => ok('suppressed'), '[data-status]'],
    ['expired token', () => fail(410, 'WAITLIST_TOKEN_EXPIRED'), '[data-alert]'],
    ['invalid token', () => fail(400, 'WAITLIST_TOKEN_INVALID'), '[data-alert]'],
  ])('confirm: %s', async (_name, response, target) => {
    mount('confirm', { responses: [response()] });
    const button = $('[data-action="confirm"]');
    button.focus();
    expect(document.activeElement).toBe(button);
    button.click();
    await flush();
    expect(button.hidden).toBe(true);
    expect(document.activeElement).toBe($(target));
    expect($(target).getAttribute('tabindex')).toBe('-1');
  });

  it('unsubscribe: focus goes to the status message', async () => {
    mount('unsubscribe', { responses: [ok('unsubscribed')] });
    const button = $('[data-action="unsubscribe"]');
    button.focus();
    button.click();
    await flush();
    expect(document.activeElement).toBe($('[data-status]'));
  });

  it('a retryable error keeps the button, enabled, and does not move focus away from it', async () => {
    mount('confirm', { responses: [fail(503, 'WAITLIST_UNAVAILABLE')] });
    const button = $('[data-action="confirm"]');
    button.focus();
    button.click();
    await flush();
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(false);
  });
});

describe('unsubscribe page', () => {
  it('does nothing on load, then removes on explicit POST', async () => {
    const { requests, events } = mount('unsubscribe', { responses: [ok('unsubscribed')] });
    await flush();
    expect(requests).toHaveLength(0);
    $('[data-action="unsubscribe"]').click();
    await flush();
    expect(requests).toEqual([{ url: '/api/v1/waitlist/unsubscribe', body: { token: TOKEN }, method: 'POST' }]);
    expect($('[data-status]').textContent).toMatch(/unsubscribed/i);
    expect(events).toEqual([]);
  });

  it('not_subscribed is reported plainly', async () => {
    mount('unsubscribe', { responses: [ok('not_subscribed')] });
    $('[data-action="unsubscribe"]').click();
    await flush();
    expect($('[data-status]').textContent).toMatch(/weren.t on the list, and we won.t add this address/i);
  });
});

describe('page token source', () => {
  it('reads the token from LcsUrlPrivacy, falling back to the fragment', () => {
    expect(waitlist.pageToken({ LcsUrlPrivacy: { takeToken: () => 'v2.a' }, location: { hash: '' } })).toBe('v2.a');
    expect(waitlist.pageToken({ location: { hash: '#token=v2.b' } })).toBe('v2.b');
    expect(waitlist.pageToken({ location: { hash: '#token=bad token' } })).toBeNull();
    expect(waitlist.pageToken({ location: { hash: '' } })).toBeNull();
  });
});
