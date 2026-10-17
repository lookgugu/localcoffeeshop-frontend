/**
 * Integration Tests — submit page success copy (`public/html/submit.html`)
 *
 * The backend accepts anonymous add/update proposals as pending moderation
 * (HTTP 202) and never writes them straight into the live directory. The
 * success message must say the proposal was submitted for review — not that
 * the shop was added/updated, published, or will be reviewed by a set time.
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

// Claims the frontend cannot honestly make for a pending-moderation proposal.
const DISHONEST_CLAIMS = [
  /added successfully/i,
  /updated successfully/i,
  /\b(has been|was) (added|updated|published|approved)\b/i,
  /\bnow (live|listed|published)\b/i,
  /\b(within|in) \d+\s*(minutes?|hours?|days?|business days?)\b/i,
  /\b24\s*hours?\b/i,
];

function expectHonestReviewCopy(text) {
  expect(text).toMatch(/submitted for review/i);
  for (const claim of DISHONEST_CLAIMS) {
    expect(text).not.toMatch(claim);
  }
}

function pendingResponse() {
  return HttpResponse.json(
    { success: true, data: { status: 'pending' } },
    { status: 202 }
  );
}

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

// Body markup only, minus <script> tags: happy-dom refuses to load scripts and
// would otherwise try to fetch the <head> stylesheets.
const BODY_MARKUP = SUBMIT_HTML
  .slice(SUBMIT_HTML.indexOf('<body>') + '<body>'.length, SUBMIT_HTML.indexOf('</body>'))
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');

describe('submit page — pending-moderation success copy', () => {
  beforeAll(async () => {
    window.CoffeeShopEnums = enums;
    window.ApiClient = api;
    await import('../../../public/submit.js');
  });

  beforeEach(() => {
    document.body.innerHTML = BODY_MARKUP;
    // submit.js wires its handlers on DOMContentLoaded, which has already
    // fired by the time the module is imported under the test runner.
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });

  afterAll(() => {
    delete window.CoffeeShopEnums;
    delete window.ApiClient;
  });

  it('static success messages say "submitted for review" without publish or timing claims', () => {
    expectHonestReviewCopy(document.getElementById('add-success').textContent);
    expectHonestReviewCopy(document.getElementById('update-success').textContent);
  });

  it('shows review copy after an anonymous POST is accepted with 202', async () => {
    const requests = [];
    server.use(
      http.post('*/api/v1/coffee-shops', ({ request }) => {
        requests.push(request);
        return pendingResponse();
      })
    );

    document.getElementById('shop-name').value = 'Test Beans';
    document.getElementById('shop-city').value = 'Austin';
    document.getElementById('shop-address').value = '1 Main St';
    document.getElementById('shop-zip').value = '78701';

    const success = document.getElementById('add-success');
    submit(document.getElementById('add-form'));
    await waitFor(() => success.style.display === 'block');

    expect(requests).toHaveLength(1);
    expect(requests[0].headers.get('authorization')).toBeNull();
    expectHonestReviewCopy(success.textContent);
    expect(document.getElementById('add-error').style.display).not.toBe('block');
  });

  it('shows review copy after an anonymous PUT is accepted with 202', async () => {
    const requests = [];
    server.use(
      http.put('*/api/v1/coffee-shops/:id', ({ request }) => {
        requests.push(request);
        return pendingResponse();
      })
    );

    document.getElementById('shop-id').value = 'shop-123';
    document.getElementById('update-name').value = 'Test Beans';
    document.getElementById('update-form').style.display = 'block';

    const success = document.getElementById('update-success');
    submit(document.getElementById('update-form'));
    await waitFor(() => success.style.display === 'block');

    expect(requests).toHaveLength(1);
    expect(requests[0].headers.get('authorization')).toBeNull();
    expectHonestReviewCopy(success.textContent);
    expect(document.getElementById('update-error').style.display).not.toBe('block');
  });
});
