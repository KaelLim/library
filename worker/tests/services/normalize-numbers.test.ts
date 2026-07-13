import { describe, it, expect } from 'vitest';
import { normalizeNumbers } from '../../src/services/normalize-numbers.js';

describe('normalizeNumbers — year', () => {
  it('converts 4-digit CJK year with 〇', () => {
    const r = normalizeNumbers('二〇二五年');
    expect(r.text).toBe('2025年');
    expect(r.conversions).toEqual([
      { original: '二〇二五年', replacement: '2025年', kind: 'year' },
    ]);
  });

  it('converts variant zero character ○', () => {
    const r = normalizeNumbers('二○二五年');
    expect(r.text).toBe('2025年');
  });

  it('converts 一九九九年', () => {
    const r = normalizeNumbers('一九九九年');
    expect(r.text).toBe('1999年');
  });

  it('preserves prose around a converted year', () => {
    const r = normalizeNumbers('二〇二五年一月');
    expect(r.text.startsWith('2025年')).toBe(true);
  });
});

describe('normalizeNumbers — date (month/day)', () => {
  it('converts 一月廿一日', () => {
    const r = normalizeNumbers('一月廿一日');
    expect(r.text).toBe('1月21日');
  });

  it('converts 十二月三十日', () => {
    const r = normalizeNumbers('十二月三十日');
    expect(r.text).toBe('12月30日');
  });

  it('converts a bare 十日 as day', () => {
    const r = normalizeNumbers('十日');
    expect(r.text).toBe('10日');
  });
});
