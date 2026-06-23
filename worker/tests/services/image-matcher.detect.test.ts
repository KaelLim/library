import { describe, it, expect } from 'vitest';
import { decideDriveStructure } from '../../src/services/image-matcher.js';

const folder = (id: string, name: string) => ({
  id,
  name,
  mimeType: 'application/vnd.google-apps.folder',
});
const image = (id: string, name: string) => ({ id, name, mimeType: 'image/jpeg' });

describe('decideDriveStructure', () => {
  it('returns categorized when 2+ subfolders and no root-level images', () => {
    const result = decideDriveStructure([
      folder('f1', '一版全球焦點'),
      folder('f2', '二版上人開示'),
    ]);
    expect(result.mode).toBe('categorized');
    if (result.mode === 'categorized') {
      expect(result.subfolders).toHaveLength(2);
      expect(result.subfolders.map((s) => s.name)).toEqual(['一版全球焦點', '二版上人開示']);
    }
  });

  it('returns flat when subfolders < 2', () => {
    const result = decideDriveStructure([folder('f1', '只有一個資料夾')]);
    expect(result.mode).toBe('flat');
    if (result.mode === 'flat') expect(result.reason).toMatch(/子資料夾不足/);
  });

  it('returns flat when root has images mixed with subfolders', () => {
    const result = decideDriveStructure([
      folder('f1', '一版'),
      folder('f2', '二版'),
      image('i1', 'stray.jpg'),
    ]);
    expect(result.mode).toBe('flat');
    if (result.mode === 'flat') expect(result.reason).toMatch(/根目錄/);
  });

  it('returns flat when root has only images', () => {
    const result = decideDriveStructure([image('i1', 'a.jpg'), image('i2', 'b.jpg')]);
    expect(result.mode).toBe('flat');
  });
});
