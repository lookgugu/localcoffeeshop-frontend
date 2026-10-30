#!/usr/bin/env node
/**
 * Copies the MapLibre GL files the "Find Near Me" map loads (#30) from
 * node_modules into public/vendor/maplibre-gl@<version>/, so the site serves
 * them itself (no third-party script host in the CSP). public/vendor/ is
 * build output and isn't committed.
 *
 * public/nearby-map.js hard-codes the version in its URLs; this fails the
 * build if the two disagree, so an upgrade can't ship a broken map.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'node_modules', 'maplibre-gl', 'dist');
const FILES = ['maplibre-gl-csp.js', 'maplibre-gl-csp-worker.js', 'maplibre-gl.css', 'LICENSE.txt'];

function installedVersion() {
    return require(path.join(ROOT, 'node_modules', 'maplibre-gl', 'package.json')).version;
}

function mapModuleVersion() {
    const source = fs.readFileSync(path.join(ROOT, 'public', 'nearby-map.js'), 'utf8');
    const match = source.match(/const MAPLIBRE_VERSION = '([^']+)'/);
    return match && match[1];
}

function main() {
    const version = installedVersion();
    const expected = mapModuleVersion();
    if (version !== expected) {
        throw new Error(`maplibre-gl ${version} is installed but public/nearby-map.js expects ${expected}`);
    }
    const dest = path.join(ROOT, 'public', 'vendor', `maplibre-gl@${version}`);
    fs.mkdirSync(dest, { recursive: true });
    for (const file of FILES) fs.copyFileSync(path.join(SRC, file), path.join(dest, file));
    console.log(`✅ Copied maplibre-gl ${version} to ${path.relative(ROOT, dest)}`);
}

if (require.main === module) main();

module.exports = { installedVersion, mapModuleVersion };
