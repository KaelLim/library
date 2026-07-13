import type { DriveFile } from './google-drive.js';

const DRIVE_PREFIX_REGEX = /^(\d+)-(\d+)-(\d+)/;

/**
 * 解析高解析度 Drive 檔名 prefix。
 * 規則：開頭三組正整數以 `-` 分隔；categoryId 必須在 1-8；articleIdx / imageIdx 必須 ≥ 1。
 * 容忍：前導 0、`-定稿`、` (1)` 等後綴。
 */
export function parseDrivePrefix(
  filename: string,
): { categoryId: number; articleIdx: number; imageIdx: number } | null {
  const match = DRIVE_PREFIX_REGEX.exec(filename);
  if (!match) return null;
  const categoryId = Number(match[1]);
  const articleIdx = Number(match[2]);
  const imageIdx = Number(match[3]);
  if (categoryId < 1 || categoryId > 8) return null;
  if (articleIdx < 1 || imageIdx < 1) return null;
  return { categoryId, articleIdx, imageIdx };
}

/** Canonical string form: `${cat}-${art}-${img}` — no leading zeros. */
export function tripleKey(t: { categoryId: number; articleIdx: number; imageIdx: number }): string {
  return `${t.categoryId}-${t.articleIdx}-${t.imageIdx}`;
}

// Match both reference-style defs and inline data-URL images. Docs export
// uses one style at a time in practice, but we count both to be robust.
const REFERENCE_IMAGE_DEF_REGEX = /\[([^\]]+)\]:\s*<?data:image\/[^;]+;base64,[^\s>]+>?/g;
const INLINE_BASE64_IMAGE_REGEX = /!\[[^\]]*\]\(data:image\/[^;]+;base64,[^)]+\)/g;

/** Count distinct base64 image resources in the Docs markdown. */
export function countDocsBase64Images(markdown: string): number {
  let count = 0;
  for (const _ of markdown.matchAll(REFERENCE_IMAGE_DEF_REGEX)) count += 1;
  for (const _ of markdown.matchAll(INLINE_BASE64_IMAGE_REGEX)) count += 1;
  return count;
}

export type ImageValidationCode =
  | 'unparseable_drive'
  | 'duplicate_drive'
  | 'count_mismatch';

export interface ImageValidationDetails {
  code: ImageValidationCode;
  docsCount?: number;
  driveCount?: number;
  /** Drive filenames whose prefix doesn't parse. */
  unparseable?: string[];
  /** x-x-x codes that map to more than one Drive file. */
  duplicates?: { xxx: string; files: string[] }[];
  /** x-x-x codes at Docs positions that have no Drive counterpart (tail when driveCount < docsCount). */
  docsPositionsWithoutDrive?: number[];
  /** x-x-x codes in Drive that have no Docs counterpart (tail when driveCount > docsCount). */
  extraInDrive?: string[];
}

export class ImageValidationError extends Error {
  details: ImageValidationDetails;
  constructor(message: string, details: ImageValidationDetails) {
    super(message);
    this.name = 'ImageValidationError';
    this.details = details;
  }
}

export interface ValidationResult {
  /** Ordered x-x-x codes; index N corresponds to the N-th Docs base64 image (0-based). */
  xxxCodes: string[];
  /** x-x-x → the Drive file to use as high-res replacement. */
  xxxToDriveFile: Map<string, DriveFile>;
}

/**
 * Cross-validate Docs base64 images against Drive x-x-x files.
 * Throws ImageValidationError on any deviation. On success returns the
 * ordered code list to feed into image-processor.
 */
export function validateDocImagesAgainstDrive(
  markdown: string,
  driveFiles: DriveFile[],
): ValidationResult {
  // U1: every Drive file's name parses to a valid x-x-x prefix.
  const unparseable: string[] = [];
  const parsedFiles: { file: DriveFile; xxx: string }[] = [];
  for (const file of driveFiles) {
    const prefix = parseDrivePrefix(file.name);
    if (!prefix) {
      unparseable.push(file.name);
    } else {
      parsedFiles.push({ file, xxx: tripleKey(prefix) });
    }
  }
  if (unparseable.length > 0) {
    throw new ImageValidationError(
      `Drive 資料夾內有無法解析編號的檔案：${unparseable.join(', ')}`,
      { code: 'unparseable_drive', unparseable },
    );
  }

  // U2: no duplicate x-x-x in Drive.
  const byXxx = new Map<string, DriveFile[]>();
  for (const { file, xxx } of parsedFiles) {
    const list = byXxx.get(xxx);
    if (list) list.push(file);
    else byXxx.set(xxx, [file]);
  }
  const duplicates: { xxx: string; files: string[] }[] = [];
  for (const [xxx, files] of byXxx) {
    if (files.length > 1) duplicates.push({ xxx, files: files.map((f) => f.name) });
  }
  if (duplicates.length > 0) {
    const summary = duplicates
      .map((d) => `x-x-x=${d.xxx}（${d.files.join(', ')}）`)
      .join('；');
    throw new ImageValidationError(
      `Drive 資料夾內同一個編號出現多次：${summary}`,
      { code: 'duplicate_drive', duplicates },
    );
  }

  // Sort by (cat, art, img) numeric ascending — canonical order.
  const sortedXxx = [...byXxx.keys()].sort((a, b) => {
    const [a1, a2, a3] = a.split('-').map(Number);
    const [b1, b2, b3] = b.split('-').map(Number);
    return a1 - b1 || a2 - b2 || a3 - b3;
  });

  // U3: Docs image count matches Drive count.
  const docsCount = countDocsBase64Images(markdown);
  const driveCount = sortedXxx.length;
  if (docsCount !== driveCount) {
    const details: ImageValidationDetails = {
      code: 'count_mismatch',
      docsCount,
      driveCount,
    };
    if (driveCount < docsCount) {
      // Positions of Docs images without a Drive counterpart (1-based tail).
      details.docsPositionsWithoutDrive = Array.from(
        { length: docsCount - driveCount },
        (_, i) => driveCount + i + 1,
      );
    } else {
      // Extra Drive x-x-x codes with no Docs image (tail of sorted list).
      details.extraInDrive = sortedXxx.slice(docsCount);
    }
    const msg =
      driveCount < docsCount
        ? `圖片數量不一致：Docs 有 ${docsCount} 張，Drive 只有 ${driveCount} 張。Docs 第 ${
            details.docsPositionsWithoutDrive!.join(', ')
          } 張沒有對應的 Drive 檔案。`
        : `圖片數量不一致：Docs 有 ${docsCount} 張，Drive 有 ${driveCount} 張。Drive 多出：${
            details.extraInDrive!.join(', ')
          }。`;
    throw new ImageValidationError(msg, details);
  }

  // Build xxx → DriveFile map (each xxx has exactly one file after U2).
  const xxxToDriveFile = new Map<string, DriveFile>();
  for (const { file, xxx } of parsedFiles) {
    xxxToDriveFile.set(xxx, file);
  }

  return { xxxCodes: sortedXxx, xxxToDriveFile };
}
