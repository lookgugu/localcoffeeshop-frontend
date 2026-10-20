// @vitest-environment node
/**
 * Every page that can load the Google tag does it the same, fail-closed way:
 * config.js, geo-consent-default.js, url-privacy.js and analytics-init.js are
 * parser-blocking and run, in that order, before the async gtag.js; there is
 * no inline gtag (no raw `gtag('config')`) anywhere. Covers hand-written,
 * generated (/roasters/), and prerendered state pages, which carry no tag.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const roasters = require('../../scripts/roasters.cjs');
const prerender = require('../../scripts/prerender-states.cjs');

const PUBLIC = resolve(__dirname, '../../public');
const GTAG = 'https://www.googletagmanager.com/gtag/js?id=G-YVSXN7PM48';
const BLOCKING = ['/geo-consent-default.js', '/url-privacy.js', '/analytics-init.js'];

function sourcePages() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      const rel = relative(PUBLIC, full);
      if (e.isDirectory()) {
        if (rel === join('pages', 'states') || rel === 'roasters' || rel === 'dist') continue;
        walk(full);
      } else if (e.name.endsWith('.html')) {
        out.push([rel, readFileSync(full, 'utf8')]);
      }
    }
  };
  walk(PUBLIC);
  return out.filter(([rel]) => /^(html|pages|waitlist)[\\/]/.test(rel) || !rel.includes('/'));
}

const tags = (html) => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map(([, attrs, body]) => ({
  src: attrs.match(/\bsrc="([^"]+)"/)?.[1] ?? null,
  async: /\basync\b/.test(attrs),
  defer: /\bdefer\b/.test(attrs),
  type: attrs.match(/\btype="([^"]+)"/)?.[1] ?? null,
  body,
}));

const pages = [
  ...sourcePages(),
  ['roasters/index.html (generated)', roasters.renderRoastersPage(roasters.loadRoasters())],
  ['pages/states/*.html (prerendered)', prerender.renderStatePages(prerender.loadEnums(), { code: 'CA', shops: [] })[0].html],
  ['pages/states/index.html (prerendered)', prerender.renderIndexPage(prerender.loadEnums(), [{ code: 'CA', shops: [] }])],
];

describe('every page that loads gtag.js', () => {
  it('finds the GA pages we expect', () => {
    const gaPages = pages.filter(([, html]) => html.includes(GTAG)).map(([n]) => n.replace(/\\/g, '/'));
    for (const p of ['html/index.html', 'html/state.html', 'html/submit.html', 'html/about.html', 'html/404.html',
      'waitlist/confirm/index.html', 'waitlist/unsubscribe/index.html', 'roasters/index.html (generated)']) {
      expect(gaPages).toContain(p);
    }
  });

  describe.each(pages)('%s', (name, html) => {
    const list = tags(html);
    const uses = html.includes(GTAG) || /gtag\(|analytics-init|url-privacy/.test(html);

    it('has no inline gtag: consent default and config live in analytics-init.js', () => {
      expect(list.some((t) => !t.src && t.type !== 'application/ld+json' && /gtag\(|dataLayer/.test(t.body))).toBe(false);
    });

    it('loads the privacy helper and init, parser-blocking, in order, before the async tag', () => {
      if (!uses) return; // pages with no Google tag (privacy, contact, prerendered states)
      const srcs = list.map((t) => t.src);
      const idx = BLOCKING.map((b) => srcs.indexOf(b));
      expect(idx.every((i) => i >= 0), `${name} missing one of ${BLOCKING}`).toBe(true);
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
      const gtagAt = srcs.indexOf(GTAG);
      expect(gtagAt).toBeGreaterThan(idx[2]);
      expect(list[gtagAt].async).toBe(true);
      for (const b of BLOCKING) {
        const t = list[srcs.indexOf(b)];
        expect(t.async || t.defer, `${b} must be parser-blocking`).toBe(false);
      }
    });

    it('a page without the tag has none of its pieces either', () => {
      if (uses) return;
      expect(html).not.toMatch(/<script[^>]+googletagmanager/);
      expect(html).not.toContain('analytics-init');
    });
  });
});
