import { describe, expect, it } from 'vitest';
import { parseGlobalSearchScope } from './cmdk-prefix';

describe('parseGlobalSearchScope', () => {
  it.each([
    ['holiday', 'all', 'holiday'],
    ['@', 'people', ''],
    ['@ alice', 'people', 'alice'],
    ['#travel', 'tags', 'travel'],
    ['/ summer', 'albums', 'summer'],
    ['> upload', 'commands', 'upload'],
  ] as const)('scopes %s', (input, scope, query) => {
    expect(parseGlobalSearchScope(input)).toEqual({ scope, query });
  });
});
