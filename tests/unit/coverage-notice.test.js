// @vitest-environment node
/**
 * Coverage/freshness notice on the discovery pages: the homepage, the
 * interactive state page and (via scripts/prerender-states.cjs) the static
 * state pages all carry the same short, honest notice: listings aren't
 * exhaustive, check details before visiting, and a correction link. No
 * "last updated" timestamps: nothing in the build knows when data was verified.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { COVERAGE_NOTICE_HTML } = require('../../scripts/prerender-states.cjs');

const PUBLIC = resolve(__dirname, '../../public');

describe('coverage notice', () => {
  it('is honest: not exhaustive, verify before visiting, correction link, no timestamps', () => {
    expect(COVERAGE_NOTICE_HTML).toMatch(/not exhaustive/i);
    expect(COVERAGE_NOTICE_HTML).toMatch(/check with the shop before you visit/i);
    expect(COVERAGE_NOTICE_HTML).toContain('<a href="/submit.html">');
    expect(COVERAGE_NOTICE_HTML).not.toMatch(/\b(updated|as of|last checked|verified on)\b|\d{4}-\d{2}-\d{2}/i);
  });

  it('the correction link points at a real page', () => {
    expect(existsSync(join(PUBLIC, 'html/submit.html'))).toBe(true);
  });

  it.each(['html/index.html', 'html/state.html'])('%s carries the same notice in <main> content', (page) => {
    const html = readFileSync(join(PUBLIC, page), 'utf8');
    const body = html.slice(html.indexOf('<body'));
    expect(body).toContain(COVERAGE_NOTICE_HTML);
  });
});
