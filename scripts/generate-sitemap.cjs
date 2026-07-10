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

/** @type {{loc: string, changefreq: string, priority: string}[]} */
const urls = [
    { loc: '/', changefreq: 'daily', priority: '1.0' },
    { loc: '/about.html', changefreq: 'monthly', priority: '0.5' },
    { loc: '/submit.html', changefreq: 'monthly', priority: '0.6' },
    { loc: '/pages/contact.html', changefreq: 'monthly', priority: '0.4' },
    { loc: '/pages/states/', changefreq: 'weekly', priority: '0.8' },
];

// One entry per state page. Files are served directly from public/pages/states/.
if (fs.existsSync(statesDir)) {
    const stateFiles = fs
        .readdirSync(statesDir)
        .filter((f) => f.endsWith('.html') && f !== 'index.html')
        .sort();
    for (const file of stateFiles) {
        urls.push({
            loc: `/pages/states/${file}`,
            changefreq: 'weekly',
            priority: '0.7',
        });
    }
}

const body = urls
    .map(
        ({ loc, changefreq, priority }) =>
            `  <url>\n` +
            `    <loc>${SITE_URL}${loc}</loc>\n` +
            `    <lastmod>${lastmod}</lastmod>\n` +
            `    <changefreq>${changefreq}</changefreq>\n` +
            `    <priority>${priority}</priority>\n` +
            `  </url>`,
    )
    .join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;

const outputPath = path.join(publicDir, 'sitemap.xml');
fs.writeFileSync(outputPath, xml);
console.log(`✅ Sitemap generated: ${urls.length} URLs -> ${path.relative(process.cwd(), outputPath)}`);
