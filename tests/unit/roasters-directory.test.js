// @vitest-environment node
/**
 * Curated roaster directory (/roasters/, #50)
 *
 * data/roasters.json is the version-controlled source; scripts/roasters.cjs
 * validates it and prerenders public/roasters/index.html, so every listing is
 * in the HTML without JavaScript.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const roasters = require('../../scripts/roasters.cjs');

const ROW = {
  id: 'example-roasters',
  name: 'Example Roasters',
  city: 'Somerville',
  state: 'MA',
  website: 'https://example-roasters.test/',
  shopUrl: 'https://example-roasters.test/collections/coffee',
  checkedAt: '2026-10-18',
  sources: [
    { url: 'https://example-roasters.test/pages/contact', evidence: 'Footer address lists Somerville, MA' },
    { url: 'https://example-roasters.test/collections/coffee', evidence: 'Collection page lists whole bean coffees' },
  ],
  shipping: { status: 'unknown' },
  pickup: { status: 'unknown' },
};

const dataset = (rows) => ({ version: 1, roasters: rows });

describe('roaster directory page', () => {
  it('lists every roaster in plain HTML with its official site and bean shop links', () => {
    const html = roasters.renderRoastersPage(dataset([ROW]));
    expect(html).toContain('<h3 class="roaster-name">Example Roasters</h3>');
    expect(html).toContain('Somerville, MA');
    expect(html).toContain('href="https://example-roasters.test/"');
    expect(html).toContain('href="https://example-roasters.test/collections/coffee"');
  });
});

const row = (overrides = {}) => ({ ...structuredClone(ROW), ...overrides });
const errorsFor = (rows) => roasters.validateRoasters(dataset(rows)).errors;

describe('roaster data validation', () => {
  it('accepts a well-formed row', () => {
    expect(errorsFor([ROW])).toEqual([]);
  });

  it('rejects an empty or malformed dataset', () => {
    expect(roasters.validateRoasters({ version: 1, roasters: [] }).errors).not.toEqual([]);
    expect(roasters.validateRoasters({ roasters: [ROW] }).errors.join('\n')).toMatch(/version/);
    expect(roasters.validateRoasters(null).errors).not.toEqual([]);
  });

  it('rejects duplicates by id, name, website host and shop URL', () => {
    const twin = row({ id: 'example-roasters-2', name: 'Other', website: 'https://other.test/', shopUrl: 'https://other.test/shop', sources: [{ url: 'https://other.test/', evidence: 'x' }] });
    expect(errorsFor([ROW, row()]).join('\n')).toMatch(/duplicate id/i);
    expect(errorsFor([ROW, { ...twin, name: 'EXAMPLE  roasters' }]).join('\n')).toMatch(/duplicate name/i);
    expect(errorsFor([ROW, { ...twin, website: 'https://www.example-roasters.test/' }]).join('\n')).toMatch(/duplicate website/i);
    expect(errorsFor([ROW, twin])).toEqual([]);
  });

  it.each([
    ['javascript:alert(1)'],
    ['http://example-roasters.test/'],
    ['https://user:pw@example-roasters.test/'],
    ['https://localhost/'],
    ['https://127.0.0.1/'],
    ['//example-roasters.test/'],
    ['not a url'],
  ])('rejects unsafe website/shop URL %s', (url) => {
    expect(errorsFor([row({ website: url })]).join('\n')).toMatch(/website/);
    expect(errorsFor([row({ shopUrl: url })]).join('\n')).toMatch(/shopUrl/);
  });

  it('requires sources from the official site, each with short evidence', () => {
    expect(errorsFor([row({ sources: [] })]).join('\n')).toMatch(/source/i);
    expect(errorsFor([row({ sources: [{ url: 'https://www.yelp.com/biz/x', evidence: 'Listed' }] })]).join('\n')).toMatch(/official/i);
    expect(errorsFor([row({ sources: [{ url: 'https://example-roasters.test/', evidence: '' }] })]).join('\n')).toMatch(/evidence/i);
    expect(errorsFor([row({ sources: [{ url: 'https://example-roasters.test/', evidence: 'x'.repeat(200) }] })]).join('\n')).toMatch(/evidence/i);
    // Official subdomains (e.g. a shop.* store) count as the official site.
    expect(errorsFor([row({ shopUrl: 'https://shop.example-roasters.test/coffee' })])).toEqual([]);
    expect(errorsFor([row({ shopUrl: 'https://marketplace.test/example' })]).join('\n')).toMatch(/shopUrl.*official/i);
  });

  it('shipping/pickup are "offered" only with official evidence; "unknown" carries none', () => {
    const offered = { status: 'offered', sourceUrl: 'https://example-roasters.test/pages/shipping', evidence: 'We ship to all 50 states' };
    expect(errorsFor([row({ shipping: offered, pickup: { ...offered, evidence: 'Local pickup available' } })])).toEqual([]);
    expect(errorsFor([row({ shipping: { status: 'offered' } })]).join('\n')).toMatch(/shipping/);
    expect(errorsFor([row({ shipping: { ...offered, sourceUrl: 'https://elsewhere.test/' } })]).join('\n')).toMatch(/shipping.*official/i);
    expect(errorsFor([row({ pickup: { status: 'unknown', evidence: 'probably' } })]).join('\n')).toMatch(/pickup/);
    expect(errorsFor([row({ pickup: { status: 'yes' } })]).join('\n')).toMatch(/pickup/);
    expect(errorsFor([row({ shipping: undefined })]).join('\n')).toMatch(/shipping/);
  });

  it('rejects unexpected fields, so prices, ratings or prose need a schema change', () => {
    expect(errorsFor([row({ price: '$18' })]).join('\n')).toMatch(/unexpected field "price"/);
    expect(errorsFor([row({ sources: [{ url: 'https://example-roasters.test/', evidence: 'x', rating: 5 }] })]).join('\n')).toMatch(/rating/);
  });

  it('validates id, name, city, state and checked date', () => {
    expect(errorsFor([row({ id: 'Bad Id' })]).join('\n')).toMatch(/id/);
    expect(errorsFor([row({ name: '  ' })]).join('\n')).toMatch(/name/);
    expect(errorsFor([row({ city: '' })]).join('\n')).toMatch(/city/);
    expect(errorsFor([row({ state: 'ZZ' })]).join('\n')).toMatch(/state/);
    expect(errorsFor([row({ checkedAt: '2026-13-01' })]).join('\n')).toMatch(/checkedAt/);
    expect(errorsFor([row({ checkedAt: '10/18/2026' })]).join('\n')).toMatch(/checkedAt/);
    expect(errorsFor([row({ checkedAt: '2999-01-01' })]).join('\n')).toMatch(/checkedAt.*future/);
  });
});

describe('roaster page escaping', () => {
  it('escapes text from the data in markup and JSON-LD', () => {
    const html = roasters.renderRoastersPage(dataset([row({ name: 'Bad <script>alert(1)</script> & "Co"' })]));
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('Bad &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Co&quot;');
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    expect(ld).not.toContain('</script');
    expect(JSON.parse(ld)['@graph'][1].mainEntity.itemListElement[0].item.name).toContain('<script>');
  });
});

describe('official stores on a hosted-shop domain', () => {
  const store = { host: 'example-roasters.myshopify.com', linkedFrom: 'https://example-roasters.test/', evidence: 'Site navigation "Shop" link goes to this store' };
  const onStore = (overrides = {}) => row({
    shopUrl: 'https://example-roasters.myshopify.com/collections/coffee',
    officialStore: store,
    sources: [
      { url: 'https://example-roasters.test/', evidence: 'Footer lists Somerville, MA; Shop link goes to the online store' },
      { url: 'https://example-roasters.myshopify.com/collections/coffee', evidence: 'Lists 12oz bags of coffee' },
    ],
    ...overrides,
  });

  it('accepts a shop on the store host the official site links to', () => {
    expect(errorsFor([onStore()])).toEqual([]);
  });

  it('rejects a store host without evidence from the official site', () => {
    expect(errorsFor([onStore({ officialStore: undefined })]).join('\n')).toMatch(/shopUrl.*official/i);
    expect(errorsFor([onStore({ officialStore: { ...store, linkedFrom: 'https://elsewhere.test/' } })]).join('\n')).toMatch(/officialStore.linkedFrom/);
    expect(errorsFor([onStore({ officialStore: { ...store, evidence: '' } })]).join('\n')).toMatch(/officialStore.evidence/);
    expect(errorsFor([onStore({ officialStore: { ...store, host: 'not a host' } })]).join('\n')).toMatch(/officialStore.host/);
  });

  it('trusts only that exact store host, not its whole platform', () => {
    expect(errorsFor([onStore({ shopUrl: 'https://someone-else.myshopify.com/collections/coffee' })]).join('\n')).toMatch(/shopUrl/);
  });

  it('still needs a source on the official website itself', () => {
    expect(errorsFor([onStore({ sources: [{ url: 'https://example-roasters.myshopify.com/', evidence: 'Store home' }] })]).join('\n'))
      .toMatch(/source on the official website/i);
  });
});
