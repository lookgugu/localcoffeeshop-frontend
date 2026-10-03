// @vitest-environment node
/**
 * Internal link check
 *
 * Every same-site href/src in the site's HTML and JS must resolve to a file
 * the deployed site actually serves. Production is a DigitalOcean App
 * Platform static site (.do/app-spec.yaml): it serves files as-is, and a
 * directory serves its index.html. There are no redirects or extensionless
 * rewrites (netlify.toml is not used), which is how /pages/about broke (#15).
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const prerender = require('../../scripts/prerender-states.cjs');
const enums = prerender.loadEnums();

const ROOT = resolve(__dirname, '../..');
const PUBLIC = join(ROOT, 'public');

// Links known to be broken, each tracked by an issue. The test also fails if
// one of these starts resolving, so the entry gets removed when it's fixed.
const KNOWN_BROKEN = {
  '/pages/privacy.html': '#18 (privacy policy page not written yet)',
};

// Build outputs that aren't committed: npm run build copies public/html/*.html
// to the site root, and the prerender step writes /pages/states/.
const STATE_SLUGS = new Set(enums.allStateCodes().map((c) => prerender.stateSlug(enums, c)));

function servedByDeploy(urlPath) {
  const clean = decodeURIComponent(urlPath.split(/[?#]/)[0]);
  const file = join(PUBLIC, clean);

  if (existsSync(file) && statSync(file).isFile()) return true;
  if (existsSync(join(file, 'index.html'))) return true;

  // build:html copies public/html/*.html to the site root (including the homepage)
  if (clean === '/') return existsSync(join(PUBLIC, 'html', 'index.html'));
  const rootHtml = clean.match(/^\/([^/]+\.html)$/);
  if (rootHtml && existsSync(join(PUBLIC, 'html', rootHtml[1]))) return true;

  // build:states prerenders the state pages
  if (clean === '/pages/states/' || clean === '/pages/states') return true;
  const statePage = clean.match(/^\/pages\/states\/([a-z0-9-]+?)(?:-(\d+))?\.html$/);
  if (statePage && STATE_SLUGS.has(statePage[1])) return true;

  return false;
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // dist/ is minified copies of these sources; pages/states/ is generated
      return ['dist', 'states'].includes(entry.name) ? [] : sourceFiles(path);
    }
    // Root-level *.html are build copies of public/html/ (gitignored)
    if (dir === PUBLIC && entry.name.endsWith('.html')) return [];
    return /\.(html|js)$/.test(entry.name) ? [path] : [];
  });
}

/** Same-site URL paths referenced as links or assets in a file. */
function internalRefs(file) {
  const text = readFileSync(file, 'utf8');
  const patterns = file.endsWith('.html')
    ? [/\b(?:href|src)=["'](\/[^"'\s]*)["']/g]
    // JS: link targets set via `href: '...'`, `.href = '...'` or markup strings
    : [/\bhref\s*[:=]\s*['"`](\/[^'"`\s]*)/g, /\b(?:href|src)=\\?["'](\/[^"'\\\s]*)/g];
  const refs = new Set();
  for (const pattern of patterns) {
    for (const [, url] of text.matchAll(pattern)) {
      if (url.startsWith('//')) continue; // protocol-relative = external
      const path = url.split('${')[0]; // template literal: keep the static prefix
      if (path) refs.add(path);
    }
  }
  return refs;
}

describe('internal links', () => {
  const files = sourceFiles(PUBLIC);

  it('scans the site sources', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.map((f) => relative(PUBLIC, f))).toEqual(
      expect.arrayContaining(['html/index.html', 'html/about.html', 'pages/contact.html', 'consent-banner.js'])
    );
  });

  it('resolve to files the deployed site serves', () => {
    const broken = [];
    for (const file of files) {
      for (const ref of internalRefs(file)) {
        if (!servedByDeploy(ref) && !(ref.split(/[?#]/)[0] in KNOWN_BROKEN)) {
          broken.push(`${relative(ROOT, file)} -> ${ref}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('allowlists only links that are still broken', () => {
    for (const url of Object.keys(KNOWN_BROKEN)) {
      expect(servedByDeploy(url), `${url} now resolves; remove it from KNOWN_BROKEN`).toBe(false);
    }
  });
});
