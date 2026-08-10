import { describe, it, expect } from 'vitest';
import {
  checkAiTimeout,
  resolveTimeoutConfig,
  DEFAULT_FIRST_TOKEN_TIMEOUT_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
  type TimeoutConfig,
} from '../../src/services/ai-timeout.js';

const CFG: TimeoutConfig = {
  firstTokenTimeoutMs: 5 * 60 * 1000,
  idleTimeoutMs: 2 * 60 * 1000,
};

describe('checkAiTimeout — before first content (first-token budget)', () => {
  it('returns null when within the generous first-token budget', () => {
    // 3 分鐘還沒吐第一個字，但預算是 5 分鐘 → 尚可
    const now = 3 * 60 * 1000;
    expect(checkAiTimeout(now, 0, false, CFG)).toBeNull();
  });

  it('returns a first-token timeout message when the first token is later than the first-token budget', () => {
    // 5 分 1 秒還沒吐第一個字 → 超過 5 分鐘預算
    const now = 5 * 60 * 1000 + 1000;
    const msg = checkAiTimeout(now, 0, false, CFG);
    expect(msg).toBe('AI query first-token timeout: no first token within 5 minutes');
  });

  it('does NOT fire at the old 2-minute mark before first content (the regression this fixes)', () => {
    // 舊行為會在 2 分鐘就砍掉；新行為在首個 token 前用 5 分鐘預算，不該砍
    const now = 2 * 60 * 1000 + 5000;
    expect(checkAiTimeout(now, 0, false, CFG)).toBeNull();
  });
});

describe('checkAiTimeout — after first content (idle budget)', () => {
  it('returns null when the mid-stream gap is within the idle budget', () => {
    const now = 90 * 1000; // 1.5 分鐘的中途間隔
    expect(checkAiTimeout(now, 0, true, CFG)).toBeNull();
  });

  it('returns an idle timeout message when a mid-stream gap exceeds the idle budget', () => {
    const now = 2 * 60 * 1000 + 1000; // 2 分 1 秒的中途間隔
    const msg = checkAiTimeout(now, 0, true, CFG);
    expect(msg).toBe('AI query idle timeout: no response for 2 minutes');
  });
});

describe('checkAiTimeout — boundary', () => {
  it('does not fire exactly at the budget (strict greater-than)', () => {
    expect(checkAiTimeout(CFG.idleTimeoutMs, 0, true, CFG)).toBeNull();
    expect(checkAiTimeout(CFG.firstTokenTimeoutMs, 0, false, CFG)).toBeNull();
  });
});

describe('resolveTimeoutConfig', () => {
  it('falls back to defaults when env is empty', () => {
    expect(resolveTimeoutConfig({})).toEqual({
      firstTokenTimeoutMs: DEFAULT_FIRST_TOKEN_TIMEOUT_MS,
      idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    });
  });

  it('reads valid overrides from env', () => {
    expect(
      resolveTimeoutConfig({
        AI_FIRST_TOKEN_TIMEOUT_MS: '360000',
        AI_IDLE_TIMEOUT_MS: '90000',
      })
    ).toEqual({ firstTokenTimeoutMs: 360000, idleTimeoutMs: 90000 });
  });

  it('ignores non-numeric / non-positive env values and uses defaults', () => {
    expect(
      resolveTimeoutConfig({
        AI_FIRST_TOKEN_TIMEOUT_MS: 'abc',
        AI_IDLE_TIMEOUT_MS: '0',
      })
    ).toEqual({
      firstTokenTimeoutMs: DEFAULT_FIRST_TOKEN_TIMEOUT_MS,
      idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    });
  });
});
