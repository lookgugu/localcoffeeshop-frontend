import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('homepage performance guard', () => {
  it('does not eagerly fetch every state detail page from the homepage', () => {
    const source = readFileSync(resolve(process.cwd(), 'public/frontend.js'), 'utf8');

    // The homepage only needs /states metadata for cards. A previous version
    // scheduled loadStateData(stateInfo.code) for every card, producing a
    // thundering herd of 50+ /states/:code requests on first paint.
    const createStateGridBody = source.match(/function createStateGrid\(\) \{([\s\S]*?)\n\s{4}\}/);

    expect(createStateGridBody).not.toBeNull();
    expect(createStateGridBody[1]).not.toContain('scheduleIdleLoad');
    expect(createStateGridBody[1]).not.toContain('loadStateData(stateInfo.code)');
  });
});
