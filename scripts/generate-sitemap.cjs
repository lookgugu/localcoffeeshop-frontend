#!/usr/bin/env node
/**
 * Generate public/sitemap.xml.
 *
 * robots.txt advertises https://localcoffeeshop.co/sitemap.xml, so this file
 * must exist. We enumerate the real, directly-servable static pages: the
 * homepage, the core content pages, and every state page under
 * public/pages/states/*.html (slug derived from the filename).
 *
 * SITE_URL can be overridden via env for preview/staging builds.
 */
const fs = require('fs');
const path = require('path');

const SITE_URL = (process.env.SITE_URL || 'https://localcoffeeshop.co').replace(/\/+$/, '');
const publicDir = path.join(__dirname, '../public');
const statesDir = path.join(publicDir, 'pages/states');

// Build date (YYYY-MM-DD) used as lastmod for generated entries.
const lastmod = new Date().toISOString().slice(0, 10);

/**
 * Every sitemap entry, in order. `lastmod` defaults to the build date; the
 * roaster directory uses the date its data was last checked instead.
 * @returns {{loc: string, changefreq: string, priority: string, lastmod?: string}[]}
 */
function sitemapUrls({ statesDir: dir = statesDir } = {}) {
    const urls = [
        { loc: '/', changefreq: 'daily', priority: '1.0' },
        { loc: '/about.html', changefreq: 'monthly', priority: '0.5' },
        { loc: '/submit.html', changefreq: 'monthly', priority: '0.6' },
        { loc: '/pages/contact.html', changefreq: 'monthly', priority: '0.4' },
        { loc: '/pages/privacy.html', changefreq: 'yearly', priority: '0.2' },
        { loc: '/pages/states/', changefreq: 'weekly', priority: '0.8' },
    ];

    // Curated roaster directory, generated from data/roasters.json by
    // scripts/roasters.cjs (which validates it first) on every build.
    const { loadRoasters, PAGE_PATH } = require('./roasters.cjs');
    const checked = loadRoasters().roasters.map((r) => r.checkedAt).sort();
    urls.push({ loc: PAGE_PATH, changefreq: 'monthly', priority: '0.7', lastmod: checked[checked.length - 1] });

    // One entry per state page. Files are prerendered into public/pages/states/
    // by scripts/prerender-states.cjs; pages marked noindex (states with no
    // listings) are left out so the sitemap only lists pages we want indexed.
    if (fs.existsSync(dir)) {
        const stateFiles = fs
            .readdirSync(dir)
            .filter((f) => f.endsWith('.html') && f !== 'index.html')
            .filter((f) => !/<meta name="robots" content="noindex/.test(
                fs.readFileSync(path.join(dir, f), 'utf8'),
            ))
            .sort();
        for (const file of stateFiles) {
            urls.push({
                loc: `/pages/states/${file}`,
                changefreq: 'weekly',
                priority: '0.7',
            });
        }
    }
    return urls;
}

function main() {
    const urls = sitemapUrls();
    const body = urls
        .map(
            ({ loc, changefreq, priority, lastmod: date = lastmod }) =>
                `  <url>\n` +
                `    <loc>${SITE_URL}${loc}</loc>\n` +
                `    <lastmod>${date}</lastmod>\n` +
                `    <changefreq>${changefreq}</changefreq>\n` +
                `    <priority>${priority}</priority>\n` +
                `  </url>`,
        )
        .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;

    const outputPath = path.join(publicDir, 'sitemap.xml');
    fs.writeFileSync(outputPath, xml);
    console.log(`✅ Sitemap generated: ${urls.length} URLs -> ${path.relative(process.cwd(), outputPath)}`);
}

module.exports = { sitemapUrls };

if (require.main === module) main();
