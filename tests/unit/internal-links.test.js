// @vitest-environment node
/**
 * Internal link check
 *
 * Every same-site href/src in the site's HTML and JS must resolve to a file
 * the deployed site actually serves. Production is a DigitalOcean App
 * Platform static site (.do/app-spec.yaml): it serves files as-is, and a
 * directory serves its index.html. There are no redirects or extensionless
 * rewrites (an old, never-applied netlify.toml was removed in #14), which is
 * how /pages/about broke (#15).
 * Relative references are resolved from each URL the page is served at.
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
const KNOWN_BROKEN = {};

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

/**
 * URLs a source file is served at. build:html copies public/html/*.html to
 * the site root, so those pages live at two URLs (/html/x.html and /x.html);
 * relative links must work from both.
 */
function deployedUrls(file) {
  const rel = '/' + relative(PUBLIC, file).split('\\').join('/');
  const copied = rel.match(/^\/html\/([^/]+\.html)$/);
  if (!copied) return [rel];
  return [rel, copied[1] === 'index.html' ? '/' : `/${copied[1]}`];
}

/** Absolute and relative references that leave the page for another URL. */
const isExternal = (url) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url);

/**
 * Same-site references in a file as [{ ref, path }], where `path` is the
 * root-relative URL path each reference resolves to from `pageUrl`.
 * Relative references in JS resolve against whatever page loads the script,
 * which can't be known statically, so only root-relative ones are checked there.
 */
function internalRefs(file, pageUrl) {
  const text = readFileSync(file, 'utf8');
  const isHtml = file.endsWith('.html');
  const patterns = isHtml
    ? [/\b(?:href|src)=["']([^"'\s]+)["']/g]
    // JS: targets set via `href: '...'`, `.href = '...'`, `.src = '...'` or markup strings
    : [/\b(?:href|src)\s*[:=]\s*['"`](\/[^'"`\s]*)/g, /\b(?:href|src)=\\?["'](\/[^"'\\\s]*)/g];
  const refs = [];
  for (const pattern of patterns) {
    for (const [, url] of text.matchAll(pattern)) {
      if (isExternal(url)) continue;
      const ref = url.split('${')[0]; // template literal: keep the static prefix
      if (!ref) continue;
      const path = new URL(ref, `https://site.invalid${pageUrl}`).pathname;
      refs.push({ ref, path });
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

  it('checks relative references too, from every URL a page is served at', () => {
    const index = join(PUBLIC, 'html', 'index.html');
    expect(deployedUrls(index)).toEqual(['/html/index.html', '/']);
    const fromRoot = internalRefs(index, '/');
    expect(fromRoot).toEqual(expect.arrayContaining([{ ref: 'submit.html', path: '/submit.html' }]));
  });

  it('checks URLs that JS assigns to href/src, including template literals', () => {
    const frontend = join(PUBLIC, 'frontend.js');
    expect(internalRefs(frontend, '/frontend.js'))
      .toEqual(expect.arrayContaining([{ ref: '/html/state.html?code=', path: '/html/state.html' }]));
  });

  it('resolve to files the deployed site serves', () => {
    const broken = [];
    for (const file of files) {
      for (const pageUrl of deployedUrls(file)) {
        for (const { ref, path } of internalRefs(file, pageUrl)) {
          if (!servedByDeploy(path) && !(path in KNOWN_BROKEN)) {
            broken.push(`${relative(ROOT, file)} (served at ${pageUrl}) -> ${ref}`);
          }
        }
      }
    }
    expect([...new Set(broken)]).toEqual([]);
  });

  it('allowlists only links that are still broken', () => {
    for (const url of Object.keys(KNOWN_BROKEN)) {
      expect(servedByDeploy(url), `${url} now resolves; remove it from KNOWN_BROKEN`).toBe(false);
    }
  });
});
