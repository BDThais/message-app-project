import { describe, expect, it } from 'vitest';
import { normalizeTel } from '@/features/friends/tel';

describe('normalizeTel', () => {
  it.each([
    ['+84912345678', '+84912345678'],
    ['+84 912 345 678', '+84912345678'],
    ['+1 (415) 555-2671', '+14155552671'],
    ['  +84-912-345-678\t', '+84912345678'],
  ])('turns %j into %j', (typed, canonical) => {
    expect(normalizeTel(typed)).toBe(canonical);
  });

  it('leaves everything else for the server to refuse, so the server decides what a number is', () => {
    expect(normalizeTel('0912 345 678')).toBe('0912345678'); // no country code: still refused by the server
    expect(normalizeTel('+84 912 345 678 ext. 5')).toBe('+84912345678ext.5');
    expect(normalizeTel('abc')).toBe('abc');
  });
});
