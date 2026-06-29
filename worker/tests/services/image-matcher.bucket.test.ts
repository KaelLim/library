import { describe, it, expect } from 'vitest';
import { bucketOrphansByCategory } from '../../src/services/image-matcher.js';
import type { OrphanLow, OrphanHigh } from '../../src/services/image-matcher.js';
import type { DriveFile } from '../../src/services/google-drive.js';

function img(id: string, name: string): DriveFile {
  return { id, name, mimeType: 'image/jpeg' };
}

describe('bucketOrphansByCategory', () => {
  it('groups low by triple.categoryId and high by prefix.categoryId', () => {
    const low: OrphanLow[] = [
      { filename: 'a.jpg', triple: { categoryId: 1, articleIdx: 1, imageIdx: 1 } },
      { filename: 'b.jpg', triple: { categoryId: 1, articleIdx: 1, imageIdx: 2 } },
      { filename: 'c.jpg', triple: { categoryId: 3, articleIdx: 1, imageIdx: 1 } },
    ];
    const high: OrphanHigh[] = [
      { file: img('h1', '1-1-1.jpg'), prefix: { categoryId: 1, articleIdx: 1, imageIdx: 1 } },
      { file: img('h2', '3-1-2.jpg'), prefix: { categoryId: 3, articleIdx: 1, imageIdx: 2 } },
    ];
    const out = bucketOrphansByCategory(low, high);
    expect(out.byCategory.get(1)!.lowFilenames).toEqual(['a.jpg', 'b.jpg']);
    expect(out.byCategory.get(1)!.highFiles.map((f) => f.id)).toEqual(['h1']);
    expect(out.byCategory.get(3)!.lowFilenames).toEqual(['c.jpg']);
    expect(out.byCategory.get(3)!.highFiles.map((f) => f.id)).toEqual(['h2']);
    expect(out.unknownHighRes).toEqual([]);
  });

  it('puts high files with prefix=null into unknownHighRes', () => {
    const high: OrphanHigh[] = [
      { file: img('h1', 'random.jpg'), prefix: null },
      { file: img('h2', '2-1-1.jpg'), prefix: { categoryId: 2, articleIdx: 1, imageIdx: 1 } },
    ];
    const out = bucketOrphansByCategory([], high);
    expect(out.unknownHighRes.map((f) => f.id)).toEqual(['h1']);
    expect(out.byCategory.get(2)!.highFiles.map((f) => f.id)).toEqual(['h2']);
  });

  it('creates a category bucket even when only one side has entries', () => {
    const low: OrphanLow[] = [
      { filename: 'a.jpg', triple: { categoryId: 5, articleIdx: 1, imageIdx: 1 } },
    ];
    const out = bucketOrphansByCategory(low, []);
    expect(out.byCategory.get(5)!.lowFilenames).toEqual(['a.jpg']);
    expect(out.byCategory.get(5)!.highFiles).toEqual([]);
  });

  it('returns empty buckets for empty inputs', () => {
    const out = bucketOrphansByCategory([], []);
    expect(out.byCategory.size).toBe(0);
    expect(out.unknownHighRes).toEqual([]);
  });
});
