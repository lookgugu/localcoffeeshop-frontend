#!/usr/bin/env node
/**
 * Builds one minified JS bundle per page into public/dist/ (#7).
 *
 * The app's scripts are classic (non-module) scripts that publish their API on
 * `window` (UMD wrappers / IIFEs), and the page code reads its deps off
 * `window` at load time. So a bundle is the ordered concatenation of those
 * scripts, minified as one program: terser keeps each file's top-level names
 * (no `toplevel` mangling), so the globals behave exactly as they did when the
 * files loaded as separate <script>s, in this order.
 *
 * A module bundler (esbuild/rollup) is deliberately not used: it would wrap
 * each UMD file as a CommonJS module, where `module.exports` exists, so the
 * files would export into the bundle instead of setting their `window` global.
 *
 * Each HTML page loads its bundle with `<script defer>`; see public/html/.
 */

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');

// Order matters: page code (last) throws if a dependency global is missing.
const SHARED = [
    'connection-banner.js',
    'service-worker-registration.js',
    'enums.js',
    'skeleton.js',
    'api-client.js',
    'store.js',
];

// Bundle URLs must never reuse a URL an earlier deploy served with different
// contents: a returning visitor's old service worker serves /dist/* cache-first
// from its precache, so new HTML pointing at a reused URL would get the old
// file (pre-#7, /dist/app.min.js and /dist/state.min.js held page code only,
// without deps). If a bundle's contract with its page ever changes
// incompatibly again, give it a new name here and in the HTML, and add the old
// one to RETIRED_DIST_URLS in tests/unit/page-assets.test.js.
const BUNDLES = {
    // Homepage (public/html/index.html)
    'dist/app.bundle.min.js': [...SHARED, 'frontend.js'],
    // State detail page (public/html/state.html)
    'dist/state.bundle.min.js': [...SHARED, 'html/state.js'],
};

/** Read a bundle's sources as { 'relative/path.js': code }, in order. */
function bundleSources(files) {
    return Object.fromEntries(
        files.map((file) => [file, fs.readFileSync(path.join(PUBLIC, file), 'utf8')])
    );
}

async function buildBundle(files) {
    const { minify } = await import('terser');
    const { code } = await minify(bundleSources(files), { compress: true, mangle: true });
    return code;
}

async function main() {
    fs.mkdirSync(path.join(PUBLIC, 'dist'), { recursive: true });
    for (const [out, files] of Object.entries(BUNDLES)) {
        const code = await buildBundle(files);
        fs.writeFileSync(path.join(PUBLIC, out), code + '\n');
        console.log(`✅ public/${out} (${files.length} files, ${code.length} bytes)`);
    }
}

module.exports = { BUNDLES, buildBundle };

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
