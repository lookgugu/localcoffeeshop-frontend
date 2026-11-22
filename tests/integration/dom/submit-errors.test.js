/**
 * Integration Tests — submit page error messages (`public/submit.js`)
 *
 * When the API refuses a proposal it explains why in its error envelope
 * (`{ success: false, error: { code, message } }`). The page must show that
 * message — e.g. "submissions are temporarily closed" — rather than the
 * client's internal "HTTP 503 for https://…" string.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { http, HttpResponse } from 'msw';
import { server } from '../../helpers/mockApi.js';

import enums from '../../../public/enums.js';
import api from '../../../public/api-client.js';

const SUBMIT_HTML = readFileSync(
  resolve(__dirname, '../../../public/html/submit.html'),
  'utf8'
);

const BODY_MARKUP = SUBMIT_HTML
  .slice(SUBMIT_HTML.indexOf('<body>') + '<body>'.length, SUBMIT_HTML.indexOf('</body>'))
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');

function submit(form) {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

async function waitFor(predicate, timeoutMs = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function fillAddForm() {
  document.getElementById('shop-name').value = 'Test Beans';
  document.getElementById('shop-city').value = 'Austin';
  document.getElementById('shop-address').value = '1 Main St';
  document.getElementById('shop-zip').value = '78701';
}

async function submitAddAndReadError() {
  const error = document.getElementById('add-error');
  submit(document.getElementById('add-form'));
  await waitFor(() => error.style.display === 'block');
  return error.textContent;
}

const CLOSED = 'Community submissions are temporarily closed. Please try again later.';

describe('submit page — error messages', () => {
  beforeAll(async () => {
    window.CoffeeShopEnums = enums;
    window.ApiClient = api;
    await import('../../../public/submit.js');
  });

  beforeEach(() => {
    document.body.innerHTML = BODY_MARKUP;
    document.dispatchEvent(new Event('DOMContentLoaded'));
    fillAddForm();
  });

  afterAll(() => {
    delete window.CoffeeShopEnums;
    delete window.ApiClient;
  });

  it('shows the server message when submissions are closed (503)', async () => {
    let attempts = 0;
    server.use(
      http.post('*/api/v1/coffee-shops', () => {
        attempts++;
        return HttpResponse.json(
          { success: false, error: { code: 'SUBMISSIONS_DISABLED', message: CLOSED } },
          { status: 503 }
        );
      })
    );

    const text = await submitAddAndReadError();
    expect(text).toBe(CLOSED);
    expect(text).not.toMatch(/HTTP \d{3}/);
    expect(attempts).toBe(1);
  });

  it('shows the validation message for a rejected proposal (400)', async () => {
    const message = 'shop.website must be an absolute http(s) URL';
    server.use(
      http.post('*/api/v1/coffee-shops', () =>
        HttpResponse.json({ success: false, error: { message } }, { status: 400 })
      )
    );

    expect(await submitAddAndReadError()).toBe(message);
  });

  it('falls back to plain English when a 503 has no envelope (e.g. a proxy error page)', async () => {
    server.use(
      http.post('*/api/v1/coffee-shops', () =>
        new HttpResponse('<html>Service Unavailable</html>', {
          status: 503,
          headers: { 'Content-Type': 'text/html' },
        })
      )
    );

    expect(await submitAddAndReadError()).toBe(
      'Submissions are temporarily unavailable. Please try again later.'
    );
  });

  it('explains rate limiting (429) without leaking the URL', async () => {
    server.use(
      http.post('*/api/v1/coffee-shops', () => new HttpResponse(null, { status: 429 }))
    );

    expect(await submitAddAndReadError()).toMatch(/too many submissions/i);
  });

  it('explains a network failure instead of showing the raw error', async () => {
    server.use(http.post('*/api/v1/coffee-shops', () => HttpResponse.error()));

    const text = await submitAddAndReadError();
    expect(text).toMatch(/couldn't reach the server/i);
    expect(text).not.toMatch(/Network failure/);
  });

  it('a later success hides the earlier error', async () => {
    server.use(
      http.post('*/api/v1/coffee-shops', () =>
        HttpResponse.json(
          { success: false, error: { code: 'SUBMISSIONS_DISABLED', message: CLOSED } },
          { status: 503 }
        ),
        { once: true }
      ),
      http.post('*/api/v1/coffee-shops', () =>
        HttpResponse.json({ success: true, data: { status: 'pending_review' } }, { status: 202 })
      )
    );

    await submitAddAndReadError();
    fillAddForm();
    const success = document.getElementById('add-success');
    submit(document.getElementById('add-form'));
    await waitFor(() => success.style.display === 'block');
    expect(document.getElementById('add-error').style.display).toBe('none');
  });
});
