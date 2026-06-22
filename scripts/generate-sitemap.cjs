#!/usr/bin/env node
/**
 * generate-sitemap.cjs
 *
 * Generates public/sitemap.xml for Local Coffee Shops.
 *
 * Includes the homepage, the core static pages, and one entry per US state.
 * State pages are the dynamic listing pages served at
 *   /html/state.html?code=XX
 * (the same URLs the homepage links to and that each page declares canonical),
 * with the two-letter code list sourced from the shared enums module so the
 * sitemap stays in sync with the app's supported states.
 */

const fs = require('fs');
const path = require('path');

// enums.js is the single source of truth for supported states. The repo is an
// ES module package ("type": "module"), so its UMD module.exports branch does
// not fire under require(). Instead we execute the (first-party, trusted) source
// in a vm sandbox that exposes a `window`, so the UMD attaches CoffeeShopEnums
// there, and read the supported states off its public allStates() API. This is
// robust to reformatting of enums.js (no source-text parsing).
function loadStates() {
  const vm = require('vm');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'enums.js'),
    'utf8'
  );
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'enums.js' });

  const enums = sandbox.window.CoffeeShopEnums;
  if (!enums || typeof enums.allStates !== 'function') {
    throw new Error('Could not load CoffeeShopEnums.allStates() from enums.js');
  }
  // allStates() returns [{ code, name }, ...] already sorted by name.
  return enums.allStates();
}

const BASE_URL = 'https://localcoffeeshop.co';
const today = new Date().toISOString().slice(0, 10);
const outPath = path.join(__dirname, '..', 'public', 'sitemap.xml');

function urlEntry(loc, priority, changefreq) {
  return [
    '  <url>',
    `    <loc>${loc}</loc>`,
    `    <lastmod>${today}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority.toFixed(1)}</priority>`,
    '  </url>'
  ].join('\n');
}

function main() {
  const urls = [];

  // Core pages (these resolve as served: / and the build-copied /about, /submit).
  urls.push(urlEntry(`${BASE_URL}/`, 1.0, 'daily'));
  urls.push(urlEntry(`${BASE_URL}/about`, 0.6, 'monthly'));
  urls.push(urlEntry(`${BASE_URL}/submit`, 0.5, 'monthly'));
  urls.push(urlEntry(`${BASE_URL}/pages/contact.html`, 0.4, 'yearly'));

  // One entry per state, using the dynamic listing URL the app actually serves.
  const states = loadStates(); // [{ code, name }, ...] sorted by name
  for (const { code } of states) {
    urls.push(urlEntry(`${BASE_URL}/html/state.html?code=${code}`, 0.7, 'weekly'));
  }

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join('\n') +
    '\n</urlset>\n';

  fs.writeFileSync(outPath, xml, 'utf8');
  console.log(`generate-sitemap: wrote ${urls.length} URLs to ${outPath}`);
}

main();
