import { describe, it, expect } from 'vitest';
import {
  parseDrivePrefix,
  tripleKey,
  countDocsBase64Images,
  validateDocImagesAgainstDrive,
  ImageValidationError,
} from '../../src/services/image-code.js';
import type { DriveFile } from '../../src/services/google-drive.js';

const df = (id: string, name: string, mimeType = 'image/jpeg'): DriveFile => ({ id, name, mimeType });

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

describe('tripleKey', () => {
  it('formats without leading zeros', () => {
    expect(tripleKey({ categoryId: 3, articleIdx: 2, imageIdx: 1 })).toBe('3-2-1');
  });
});

describe('countDocsBase64Images', () => {
  it('counts inline base64', () => {
    const md = `![a](data:image/png;base64,AAA) text ![b](data:image/jpeg;base64,BBB)`;
    expect(countDocsBase64Images(md)).toBe(2);
  });

  it('counts reference-style defs', () => {
    const md = `
![alt][img1]
![alt2][img2]

[img1]: <data:image/png;base64,AAA>
[img2]: <data:image/jpeg;base64,BBB>
`;
    expect(countDocsBase64Images(md)).toBe(2);
  });

  it('counts both styles combined', () => {
    const md = `
![inline](data:image/png;base64,AAA)
![ref][x]
[x]: <data:image/jpeg;base64,BBB>
`;
    expect(countDocsBase64Images(md)).toBe(2);
  });

  it('returns 0 for empty markdown', () => {
    expect(countDocsBase64Images('')).toBe(0);
  });

  it('returns 0 when only URL images present', () => {
    expect(countDocsBase64Images('![a](https://cdn/foo.jpg)')).toBe(0);
  });
});

describe('validateDocImagesAgainstDrive', () => {
  const docsWith = (n: number) =>
    Array.from({ length: n }, (_, i) => `![alt${i}](data:image/png;base64,PAYLOAD${i}==)`).join('\n');

  it('happy path: counts and codes match', () => {
    const md = docsWith(3);
    const files = [
      df('a', '1-1-1.jpg'),
      df('b', '1-2-1-封面.jpg'),
      df('c', '2-1-1.png'),
    ];
    const result = validateDocImagesAgainstDrive(md, files);
    expect(result.xxxCodes).toEqual(['1-1-1', '1-2-1', '2-1-1']);
    expect(result.xxxToDriveFile.get('1-1-1')?.id).toBe('a');
    expect(result.xxxToDriveFile.get('1-2-1')?.id).toBe('b');
    expect(result.xxxToDriveFile.get('2-1-1')?.id).toBe('c');
  });

  it('sorts xxxCodes by (cat, art, img) numeric ascending', () => {
    const md = docsWith(4);
    const files = [
      df('a', '2-1-1.jpg'),
      df('b', '1-1-2.jpg'),
      df('c', '1-1-1.jpg'),
      df('d', '1-2-1.jpg'),
    ];
    const result = validateDocImagesAgainstDrive(md, files);
    expect(result.xxxCodes).toEqual(['1-1-1', '1-1-2', '1-2-1', '2-1-1']);
  });

  it('throws unparseable_drive when Drive has a file without x-x-x prefix', () => {
    const md = docsWith(1);
    const files = [df('a', '1-1-1.jpg'), df('b', 'random.jpg')];
    try {
      validateDocImagesAgainstDrive(md, files);
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ImageValidationError);
      expect((e as ImageValidationError).details.code).toBe('unparseable_drive');
      expect((e as ImageValidationError).details.unparseable).toEqual(['random.jpg']);
    }
  });

  it('throws duplicate_drive when two files share the same x-x-x', () => {
    const md = docsWith(2);
    const files = [
      df('a', '1-1-1-封面.jpg'),
      df('b', '1-1-1-定稿.jpg'),
      df('c', '1-1-2.jpg'),
    ];
    try {
      validateDocImagesAgainstDrive(md, files);
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ImageValidationError);
      const err = e as ImageValidationError;
      expect(err.details.code).toBe('duplicate_drive');
      expect(err.details.duplicates).toEqual([
        { xxx: '1-1-1', files: ['1-1-1-封面.jpg', '1-1-1-定稿.jpg'] },
      ]);
    }
  });

  it('throws count_mismatch with docsPositionsWithoutDrive when Docs > Drive', () => {
    const md = docsWith(5);
    const files = [
      df('a', '1-1-1.jpg'),
      df('b', '1-2-1.jpg'),
      df('c', '2-1-1.jpg'),
    ];
    try {
      validateDocImagesAgainstDrive(md, files);
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ImageValidationError);
      const err = e as ImageValidationError;
      expect(err.details.code).toBe('count_mismatch');
      expect(err.details.docsCount).toBe(5);
      expect(err.details.driveCount).toBe(3);
      expect(err.details.docsPositionsWithoutDrive).toEqual([4, 5]);
    }
  });

  it('throws count_mismatch with extraInDrive when Drive > Docs', () => {
    const md = docsWith(2);
    const files = [
      df('a', '1-1-1.jpg'),
      df('b', '1-1-2.jpg'),
      df('c', '3-1-1.jpg'),
      df('d', '3-1-2.jpg'),
    ];
    try {
      validateDocImagesAgainstDrive(md, files);
      throw new Error('expected to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ImageValidationError);
      const err = e as ImageValidationError;
      expect(err.details.code).toBe('count_mismatch');
      expect(err.details.docsCount).toBe(2);
      expect(err.details.driveCount).toBe(4);
      expect(err.details.extraInDrive).toEqual(['3-1-1', '3-1-2']);
    }
  });

  it('accepts empty markdown paired with empty Drive folder', () => {
    const result = validateDocImagesAgainstDrive('', []);
    expect(result.xxxCodes).toEqual([]);
    expect(result.xxxToDriveFile.size).toBe(0);
  });
});
