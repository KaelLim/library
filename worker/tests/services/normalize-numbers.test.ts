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

describe('normalizeNumbers — time', () => {
  it('converts 三時 (hour)', () => {
    const r = normalizeNumbers('下午三時');
    expect(r.text).toBe('下午3時');
  });

  it('converts 二十四時', () => {
    const r = normalizeNumbers('二十四時');
    expect(r.text).toBe('24時');
  });

  it('skips out-of-range 二十五時', () => {
    const r = normalizeNumbers('二十五時');
    expect(r.text).toBe('二十五時');
    expect(r.conversions).toEqual([]);
  });

  it('converts 三十分', () => {
    const r = normalizeNumbers('三十分');
    expect(r.text).toBe('30分');
  });

  it('converts 五點', () => {
    const r = normalizeNumbers('五點');
    expect(r.text).toBe('5點');
  });
});

describe('normalizeNumbers — quantity + measure word', () => {
  it('converts 六戶居民', () => {
    const r = normalizeNumbers('六戶居民');
    expect(r.text).toBe('6戶居民');
  });

  it('converts 三十二人參加', () => {
    const r = normalizeNumbers('三十二人參加');
    expect(r.text).toBe('32人參加');
  });

  it('converts 兩年', () => {
    const r = normalizeNumbers('兩年');
    expect(r.text).toBe('2年');
  });

  it('does NOT convert 十位 in isolation without allowlisted measure', () => {
    // The allowlist includes 位, so this DOES convert. Rename target: use a non-allowlisted word.
    const r = normalizeNumbers('十樣');
    expect(r.text).toBe('十樣');
    expect(r.conversions).toEqual([]);
  });

  it('converts 一百二十三 followed by allowlisted measure', () => {
    // Out of scope for cycle C — allowlist restricts to 1–2 digit multiplicative.
    // Verify the 3-digit multiplicative is left alone.
    const r = normalizeNumbers('一百二十三人');
    expect(r.text).toBe('一百二十三人');
  });
});
