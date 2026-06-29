import { describe, it, expect } from 'vitest';
import { computeStrategy } from '../../src/services/image-matcher.js';

describe('computeStrategy', () => {
  it('returns skipped-no-drive-images when Drive yielded nothing', () => {
    expect(
      computeStrategy({ driveTotal: 0, lowResTotal: 5, prefixMatched: 0, visionAttempted: false }),
    ).toBe('skipped-no-drive-images');
  });

  it('returns skipped-no-low-res when markdown has no image references', () => {
    expect(
      computeStrategy({ driveTotal: 5, lowResTotal: 0, prefixMatched: 0, visionAttempted: false }),
    ).toBe('skipped-no-low-res');
  });

  it('skipped-no-drive-images takes precedence over no-low-res', () => {
    expect(
      computeStrategy({ driveTotal: 0, lowResTotal: 0, prefixMatched: 0, visionAttempted: false }),
    ).toBe('skipped-no-drive-images');
  });

  it('prefix-only when all matched via prefix and Vision was not invoked', () => {
    expect(
      computeStrategy({ driveTotal: 5, lowResTotal: 5, prefixMatched: 5, visionAttempted: false }),
    ).toBe('prefix-only');
  });

  it('prefix-with-fallback when prefix matched some and Vision was invoked', () => {
    expect(
      computeStrategy({ driveTotal: 6, lowResTotal: 5, prefixMatched: 3, visionAttempted: true }),
    ).toBe('prefix-with-fallback');
  });

  it('vision-only when prefix matched nothing but Vision was invoked', () => {
    expect(
      computeStrategy({ driveTotal: 5, lowResTotal: 5, prefixMatched: 0, visionAttempted: true }),
    ).toBe('vision-only');
  });

  it('prefix-only when neither prefix nor Vision matched (no work attempted)', () => {
    expect(
      computeStrategy({ driveTotal: 5, lowResTotal: 5, prefixMatched: 0, visionAttempted: false }),
    ).toBe('prefix-only');
  });
});
