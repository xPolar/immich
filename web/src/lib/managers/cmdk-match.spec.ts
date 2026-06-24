import { describe, expect, it } from 'vitest';
import { isAlmostExactWordMatch } from './cmdk-match';

describe('isAlmostExactWordMatch', () => {
  it('promotes a relevant command or navigation label', () => {
    expect(isAlmostExactWordMatch('upl', 'Upload')).toBe(true);
    expect(isAlmostExactWordMatch('system set', 'System Settings')).toBe(true);
  });

  it('does not promote short or unrelated matches', () => {
    expect(isAlmostExactWordMatch('up', 'Upload')).toBe(false);
    expect(isAlmostExactWordMatch('album', 'Upload')).toBe(false);
  });
});
