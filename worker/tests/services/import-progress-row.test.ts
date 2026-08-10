import { describe, it, expect } from 'vitest';
import { toProgressRow } from '../../src/services/import-progress-row.js';

describe('toProgressRow — 進行中的步驟', () => {
  it('把 progress 文字寫入 import_progress，import_error 為 null', () => {
    expect(toProgressRow({ step: 'ai_parsing', progress: 'AI 解析中...' })).toEqual({
      import_step: 'ai_parsing',
      import_progress: 'AI 解析中...',
      import_error: null,
    });
  });
});

describe('toProgressRow — 失敗', () => {
  it('把真正失敗的步驟 (failedStep) 塞進 import_progress，供 reload 還原', () => {
    expect(
      toProgressRow({ step: 'failed', error: 'AI query idle timeout', failedStep: 'ai_parsing' })
    ).toEqual({
      import_step: 'failed',
      import_progress: 'ai_parsing',
      import_error: 'AI query idle timeout',
    });
  });

  it('沒有 failedStep 時 import_progress 為 null（不退回顯示 progress 文字）', () => {
    expect(toProgressRow({ step: 'failed', error: 'boom' })).toEqual({
      import_step: 'failed',
      import_progress: null,
      import_error: 'boom',
    });
  });
});

describe('toProgressRow — 完成', () => {
  it('completed 步驟照常把 progress 放 import_progress', () => {
    expect(toProgressRow({ step: 'completed', progress: '完成！' })).toEqual({
      import_step: 'completed',
      import_progress: '完成！',
      import_error: null,
    });
  });
});
