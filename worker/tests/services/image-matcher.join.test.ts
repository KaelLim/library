import { describe, it, expect } from 'vitest';
import { joinByTriple } from '../../src/services/image-matcher.js';
import type { ImageTriple } from '../../src/services/image-matcher.js';
import type { DriveFile } from '../../src/services/google-drive.js';

function img(id: string, name: string): DriveFile {
  return { id, name, mimeType: 'image/jpeg' };
}

describe('joinByTriple', () => {
  it('matches one-to-one when low and high align', () => {
    const low = new Map<string, ImageTriple>([
      ['image1.jpg', { categoryId: 1, articleIdx: 1, imageIdx: 1 }],
      ['image2.jpg', { categoryId: 3, articleIdx: 2, imageIdx: 1 }],
    ]);
    const high: DriveFile[] = [img('d1', '1-1-1.jpg'), img('d2', '3-2-1.jpg')];
    const out = joinByTriple(low, high);
    expect(out.matched).toEqual([
      { lowFilename: 'image1.jpg', driveFileId: 'd1', driveFileName: '1-1-1.jpg', mimeType: 'image/jpeg' },
      { lowFilename: 'image2.jpg', driveFileId: 'd2', driveFileName: '3-2-1.jpg', mimeType: 'image/jpeg' },
    ]);
    expect(out.orphanLow).toEqual([]);
    expect(out.orphanHigh).toEqual([]);
    expect(out.conflictTriples).toEqual([]);
  });

  it('puts low images with no high match into orphanLow', () => {
    const low = new Map<string, ImageTriple>([
      ['image1.jpg', { categoryId: 1, articleIdx: 1, imageIdx: 1 }],
      ['image2.jpg', { categoryId: 1, articleIdx: 1, imageIdx: 2 }],
    ]);
    const high: DriveFile[] = [img('d1', '1-1-1.jpg')];
    const out = joinByTriple(low, high);
    expect(out.matched).toHaveLength(1);
    expect(out.orphanLow).toEqual([
      { filename: 'image2.jpg', triple: { categoryId: 1, articleIdx: 1, imageIdx: 2 } },
    ]);
    expect(out.orphanHigh).toEqual([]);
  });

  it('puts unclaimed high images into orphanHigh with their parsed prefix', () => {
    const low = new Map<string, ImageTriple>([
      ['image1.jpg', { categoryId: 1, articleIdx: 1, imageIdx: 1 }],
    ]);
    const high: DriveFile[] = [img('d1', '1-1-1.jpg'), img('d2', '2-1-1.jpg')];
    const out = joinByTriple(low, high);
    expect(out.matched).toHaveLength(1);
    expect(out.orphanHigh).toEqual([
      { file: high[1], prefix: { categoryId: 2, articleIdx: 1, imageIdx: 1 } },
    ]);
  });

  it('flags unparseable high-res files in orphanHigh with prefix=null', () => {
    const low = new Map<string, ImageTriple>();
    const high: DriveFile[] = [img('d1', 'random.jpg')];
    const out = joinByTriple(low, high);
    expect(out.orphanHigh).toEqual([{ file: high[0], prefix: null }]);
  });

  it('on triple collision (two high files parse to same key): low goes to orphan, both highs go to orphan, key recorded', () => {
    const low = new Map<string, ImageTriple>([
      ['image1.jpg', { categoryId: 3, articleIdx: 2, imageIdx: 3 }],
    ]);
    const high: DriveFile[] = [img('d1', '3-2-3.jpg'), img('d2', '3-2-3-定稿.jpg')];
    const out = joinByTriple(low, high);
    expect(out.matched).toEqual([]);
    expect(out.orphanLow).toEqual([
      { filename: 'image1.jpg', triple: { categoryId: 3, articleIdx: 2, imageIdx: 3 } },
    ]);
    expect(out.orphanHigh).toHaveLength(2);
    expect(out.orphanHigh.map((o) => o.file.id).sort()).toEqual(['d1', 'd2']);
    expect(out.conflictTriples).toEqual(['3-2-3']);
  });

  it('returns empty outcome for empty inputs', () => {
    const out = joinByTriple(new Map(), []);
    expect(out).toEqual({ matched: [], orphanLow: [], orphanHigh: [], conflictTriples: [] });
  });

  it('treats unparseable high as separate from triple collisions', () => {
    const low = new Map<string, ImageTriple>([
      ['image1.jpg', { categoryId: 1, articleIdx: 1, imageIdx: 1 }],
    ]);
    const high: DriveFile[] = [img('d1', '1-1-1.jpg'), img('d2', 'random.jpg')];
    const out = joinByTriple(low, high);
    expect(out.matched).toHaveLength(1);
    expect(out.orphanHigh).toEqual([{ file: high[1], prefix: null }]);
    expect(out.conflictTriples).toEqual([]);
  });
});
