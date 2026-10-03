// @vitest-environment node
/**
 * Production build dependencies
 *
 * DigitalOcean App Platform builds with NODE_ENV=production (.do/app-spec.yaml),
 * so `npm ci` skips devDependencies. Anything `npm run build` loads must be a
 * regular dependency, or every deploy fails while the last good one stays live
 * (this happened after #27: build-js.cjs imports terser, a devDependency).
 */

import { describe, it, expect } from 'vitest';
import { builtinModules } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

/** npm scripts reachable from `build`, following `npm run x` chains. */
function buildScripts(name = 'build', seen = new Set()) {
  if (seen.has(name)) return seen;
  seen.add(name);
  for (const [, next] of (pkg.scripts[name] || '').matchAll(/npm run ([\w:-]+)/g)) {
    buildScripts(next, seen);
  }
  return seen;
}

/** Package name of a bare specifier ("@scope/pkg/x" -> "@scope/pkg"). */
const packageName = (spec) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

/** Bare packages a script file loads, following relative requires. */
function packagesLoadedBy(file, seen = new Set(), found = new Set()) {
  if (seen.has(file) || !existsSync(file)) return found;
  seen.add(file);
  const source = readFileSync(file, 'utf8');
  for (const [, spec] of source.matchAll(/\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (spec.startsWith('.')) {
      const target = resolve(dirname(file), spec);
      packagesLoadedBy(existsSync(target) ? target : `${target}.cjs`, seen, found);
    } else if (!BUILTINS.has(spec)) {
      found.add(packageName(spec));
    }
  }
  return found;
}

function packagesUsedByBuild() {
  const used = new Map(); // package -> where it's used
  for (const script of buildScripts()) {
    const command = pkg.scripts[script] || '';
    for (const [, bin] of command.matchAll(/\bnpx (?:--?[\w-]+ )*([@\w][\w./@-]*)/g)) {
      used.set(packageName(bin), `npm script "${script}" (npx)`);
    }
    for (const [, path] of command.matchAll(/\bnode ([\w./-]+\.c?js)/g)) {
      for (const name of packagesLoadedBy(join(ROOT, path))) used.set(name, path);
    }
  }
  return used;
}

describe('production build dependencies', () => {
  it('finds the build steps and the packages they load', () => {
    expect([...buildScripts()]).toEqual(expect.arrayContaining(['build:js', 'build:css', 'build:states']));
    expect([...packagesUsedByBuild().keys()]).toEqual(expect.arrayContaining(['terser', 'clean-css-cli']));
  });

  it('declares everything `npm run build` loads in dependencies, not devDependencies', () => {
    const missing = [...packagesUsedByBuild()]
      .filter(([name]) => !(name in (pkg.dependencies || {})))
      .map(([name, where]) => `${name} (used by ${where})`);

    expect(missing).toEqual([]);
  });
});
