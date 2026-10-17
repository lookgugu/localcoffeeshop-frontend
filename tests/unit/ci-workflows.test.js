// @vitest-environment node
/**
 * CI wiring: tests + build run for every pull request and push to main, and
 * the GET-only smoke check (scripts/smoke-check.cjs) runs on a schedule.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKFLOWS = resolve(__dirname, '../../.github/workflows');
const read = (name) => readFileSync(resolve(WORKFLOWS, name), 'utf8');

describe('ci.yml', () => {
  it('runs on pull requests and pushes to main', () => {
    const yml = read('ci.yml');
    expect(yml).toMatch(/^\s+pull_request:/m);
    expect(yml).toMatch(/^\s+push:\s*\n\s+branches:\s*\[\s*main\s*\]/m);
  });

  it('installs from the lockfile, runs the full test suite once, and builds', () => {
    const yml = read('ci.yml');
    expect(yml).toContain('npm ci');
    expect(yml).toContain('npm test -- --run');
    expect(yml).toContain('npm run build');
  });
});

describe('smoke.yml', () => {
  it('runs the smoke check on a schedule and on demand, never on PRs', () => {
    expect(existsSync(resolve(WORKFLOWS, 'smoke.yml'))).toBe(true);
    const yml = read('smoke.yml');
    expect(yml).toMatch(/schedule:\s*\n\s+- cron: '[^']+'/);
    expect(yml).toContain('workflow_dispatch');
    expect(yml).not.toMatch(/pull_request/);
    expect(yml).toContain('npm run smoke');
  });

  it('needs no secrets (public GETs only)', () => {
    expect(read('smoke.yml')).not.toMatch(/secrets\./);
  });
});
