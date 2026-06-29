import { describe, it, expect } from 'vitest';
import { parseDrivePrefix } from '../../src/services/image-matcher.js';

describe('parseDrivePrefix', () => {
  it('parses canonical x-x-x.ext', () => {
    expect(parseDrivePrefix('3-2-3.jpg')).toEqual({ categoryId: 3, articleIdx: 2, imageIdx: 3 });
  });

  it('parses with trailing chinese suffix', () => {
    expect(parseDrivePrefix('3-2-3-定稿.jpg')).toEqual({ categoryId: 3, articleIdx: 2, imageIdx: 3 });
  });

  it('parses with trailing parenthesized index', () => {
    expect(parseDrivePrefix('3-2-3 (1).png')).toEqual({ categoryId: 3, articleIdx: 2, imageIdx: 3 });
  });

  it('tolerates leading zeros', () => {
    expect(parseDrivePrefix('03-02-03.jpg')).toEqual({ categoryId: 3, articleIdx: 2, imageIdx: 3 });
  });

  it('rejects prefix not at start of filename', () => {
    expect(parseDrivePrefix('cover-3-2-3.jpg')).toBeNull();
  });

  it('rejects categoryId > 8', () => {
    expect(parseDrivePrefix('9-1-1.jpg')).toBeNull();
  });

  it('rejects categoryId < 1', () => {
    expect(parseDrivePrefix('0-1-1.jpg')).toBeNull();
  });

  it('rejects articleIdx of 0', () => {
    expect(parseDrivePrefix('1-0-1.jpg')).toBeNull();
  });

  it('rejects imageIdx of 0', () => {
    expect(parseDrivePrefix('1-1-0.jpg')).toBeNull();
  });

  it('returns null for unrelated filename', () => {
    expect(parseDrivePrefix('random.jpg')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseDrivePrefix('')).toBeNull();
  });

  it('returns null when fewer than three segments', () => {
    expect(parseDrivePrefix('3-2.jpg')).toBeNull();
  });
});
