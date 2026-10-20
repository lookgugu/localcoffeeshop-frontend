// @vitest-environment node
/**
 * Waitlist wiring across pages
 *
 * - One source of truth for the form markup (scripts/waitlist-markup.cjs),
 *   embedded verbatim in the homepage and the generated /roasters/ page.
 * - url-privacy.js runs before the Google tag is configured on every page
 *   that can carry search text or a token.
 * - Confirm/unsubscribe pages are noindex, have no inline scripts and load
 *   the scripts they need in order.
 * - Copy is interest-only: no price, checkout, partnership or launch promise.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { renderWaitlistSection } = require('../../scripts/waitlist-markup.cjs');
const roasters = require('../../scripts/roasters.cjs');

const ROOT = resolve(__dirname, '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const scriptSrcs = (html) => [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);

const index = read('public/html/index.html');
const roasterPage = roasters.renderRoastersPage(roasters.loadRoasters());
const confirmPage = read('public/waitlist/confirm/index.html');
const unsubscribePage = read('public/waitlist/unsubscribe/index.html');

describe('form markup', () => {
  it('the homepage embeds the generated form verbatim', () => {
    expect(index).toContain(renderWaitlistSection('home'));
  });

  it('the roaster page embeds it with its own source', () => {
    expect(roasterPage).toContain(renderWaitlistSection('roasters'));
  });

  it('rejects unknown sources', () => {
    expect(() => renderWaitlistSection('popup')).toThrow();
  });

  it('is not a popup/dialog and the consent box is unchecked', () => {
    for (const source of ['home', 'roasters']) {
      const html = renderWaitlistSection(source);
      expect(html).not.toMatch(/role="dialog"|<dialog|aria-modal/);
      expect(html).toMatch(/<input type="checkbox"[^>]*name="consent"/);
      expect(html).not.toMatch(/name="consent"[^>]*\bchecked\b/);
      expect(html).toMatch(/novalidate/);
    }
  });

  it('makes no price, checkout, partnership or launch promise', () => {
    const text = renderWaitlistSection('home').replace(/<[^>]+>/g, ' ');
    expect(text).not.toMatch(/\$\s?\d|per month for|checkout|buy now|pre-?order|partner(ed|ship)? with|guarantee|launching (on|in)/i);
    expect(text).toMatch(/not decided/i);
    expect(text).toMatch(/may not launch/i);
  });
});

describe('script order', () => {
  it('homepage: same blocking order as every GA page, then the deferred page scripts', () => {
    const order = scriptSrcs(index);
    const gtag = 'https://www.googletagmanager.com/gtag/js?id=G-YVSXN7PM48';
    expect(order.slice(0, 5)).toEqual(['/config.js', '/geo-consent-default.js', '/url-privacy.js', '/analytics-init.js', gtag]);
    expect(index).toMatch(/<script src="\/url-privacy.js"><\/script>/);
    expect(index).not.toMatch(/gtag\(/); // no inline gtag: analytics-init.js owns consent default + config
    expect(order).toEqual(expect.arrayContaining(['/analytics-events.js', '/waitlist.js']));
    expect(order.indexOf('/analytics-events.js')).toBeLessThan(order.indexOf('/dist/app.bundle.min.js'));
  });

  it.each([
    ['roasters', roasterPage, '/roasters.js'],
    ['confirm', confirmPage, null],
    ['unsubscribe', unsubscribePage, null],
  ])('%s page script order', (_name, html, pageScript) => {
    const expected = [
      '/config.js',
      '/geo-consent-default.js',
      '/url-privacy.js',
      '/analytics-init.js',
      'https://www.googletagmanager.com/gtag/js?id=G-YVSXN7PM48',
      '/consent-banner.js',
      '/analytics-events.js',
      ...(pageScript ? [pageScript] : []),
      '/waitlist.js',
    ];
    expect(scriptSrcs(html)).toEqual(expected);
  });
});

describe('confirm and unsubscribe pages', () => {
  it.each([['confirm', confirmPage], ['unsubscribe', unsubscribePage]])('%s is noindex, inline-script-free and explicit-POST only', (name, html) => {
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    for (const [, attrs, inner] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      expect(attrs).toMatch(/\bsrc="/);
      expect(inner.trim()).toBe('');
    }
    expect(html).not.toMatch(/\son[a-z]+="/i);
    expect(html).toContain(`data-action="${name}"`);
    expect(html).not.toMatch(/<form[^>]*method="get"/i);
    expect(html).toMatch(/<noscript>/);
  });
});

describe('privacy policy', () => {
  const privacy = read('public/pages/privacy.html');
  it('has a waitlist section naming the provider, unsubscribe and analytics boundaries', () => {
    const section = privacy.slice(privacy.indexOf('id="waitlist"'));
    expect(section).toMatch(/Resend/);
    expect(section).toMatch(/unsubscribe/i);
    expect(section).toMatch(/not .*Google Analytics|never sent to Google Analytics/i);
  });

  it('is honest about Consent Mode: analytics cookies/storage denied, limited cookieless pings may still occur', () => {
    const text = privacy.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toMatch(/turn off analytics cookies and storage/i);
    expect(text).toMatch(/cookieless pings/i);
    expect(text).toMatch(/sets no analytics cookie/i);
    expect(text).toMatch(/California or UTC time zone/i);
    // The old, inaccurate claims are gone.
    expect(text).not.toMatch(/lets you turn it off\./i);
    expect(text).not.toMatch(/analytics is off by default/i);
  });

  it('does not describe a request being accepted as an email being sent', () => {
    expect(privacy).toMatch(/does not mean an email was sent/i);
    expect(privacy).not.toMatch(/provider accepted/i);
  });
});

describe('build wiring', () => {
  const pkg = JSON.parse(read('package.json'));
  it('the waitlist stylesheet is in the CSS bundle and QA has a script', () => {
    expect(pkg.scripts['build:css']).toContain('public/styles/waitlist.css');
    expect(pkg.scripts['qa:waitlist']).toBe('node scripts/waitlist-qa.mjs');
  });
});
