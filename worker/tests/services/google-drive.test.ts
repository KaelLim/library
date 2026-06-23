import { describe, it, expect } from 'vitest';
import { filterSubfolders } from '../../src/services/google-drive.js';

describe('filterSubfolders', () => {
  it('returns only folder mime-type entries with id+name', () => {
    const files = [
      { id: 'f1', name: '一版全球焦點', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'i1', name: 'photo.jpg', mimeType: 'image/jpeg' },
      { id: 'f2', name: '二版上人開示', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'd1', name: 'doc.pdf', mimeType: 'application/pdf' },
    ];
    expect(filterSubfolders(files)).toEqual([
      { id: 'f1', name: '一版全球焦點' },
      { id: 'f2', name: '二版上人開示' },
    ]);
  });

  it('returns empty array when no folders present', () => {
    const files = [{ id: 'i1', name: 'a.jpg', mimeType: 'image/jpeg' }];
    expect(filterSubfolders(files)).toEqual([]);
  });
});
