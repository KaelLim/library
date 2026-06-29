import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import {
  downloadFile,
  listImagesRecursive,
  type DriveFile,
} from './google-drive.js';
import { runSessionWithStreaming } from './session-streamer.js';
import { getSupabase, uploadImage } from './supabase.js';
import { compressImage } from './image-compressor.js';
import type { ParsedWeekly } from '../types/index.js';

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

const IMAGE_FILENAME_REGEX = /\/images\/(image\d+\.\w+)\)/g;

export type ImageTriple = { categoryId: number; articleIdx: number; imageIdx: number };

/**
 * 從 parse 結果推導每張低解析度圖對應的三元組 (categoryId, articleIdx, imageIdx)。
 * - articleIdx：該分類內第幾篇文稿（1-based）
 * - imageIdx：該篇 article.content 中第幾張圖（1-based，依 regex 順序）
 * 同檔名跨多版引用時，第一次出現勝出。
 */
export function deriveImageTripleMap(parsed: ParsedWeekly): Map<string, ImageTriple> {
  const map = new Map<string, ImageTriple>();
  for (const category of parsed.categories) {
    let articleIdx = 0;
    for (const article of category.articles) {
      articleIdx += 1;
      IMAGE_FILENAME_REGEX.lastIndex = 0;
      let imageIdx = 0;
      let match;
      while ((match = IMAGE_FILENAME_REGEX.exec(article.content)) !== null) {
        imageIdx += 1;
        const filename = match[1];
        if (!map.has(filename)) {
          map.set(filename, {
            categoryId: category.category_id,
            articleIdx,
            imageIdx,
          });
        }
      }
    }
  }
  return map;
}

export interface PrefixMatch {
  lowFilename: string;
  driveFileId: string;
  driveFileName: string;
  mimeType: string;
}

export interface OrphanLow {
  filename: string;
  triple: ImageTriple;
}

export interface OrphanHigh {
  file: DriveFile;
  prefix: { categoryId: number; articleIdx: number; imageIdx: number } | null;
}

export interface JoinOutcome {
  matched: PrefixMatch[];
  orphanLow: OrphanLow[];
  orphanHigh: OrphanHigh[];
  conflictTriples: string[];
}

function tripleKey(t: { categoryId: number; articleIdx: number; imageIdx: number }): string {
  return `${t.categoryId}-${t.articleIdx}-${t.imageIdx}`;
}

/**
 * Pass 1：以三元組 key 將低解析度與高解析度做 deterministic JOIN。
 * 衝突（多個 Drive 檔解析出同一 key） → 該 low 與所有 high 皆進 orphans。
 * 解不出 prefix 的 high → 進 orphanHigh，prefix=null。
 */
export function joinByTriple(
  lowMap: Map<string, ImageTriple>,
  highFiles: DriveFile[],
): JoinOutcome {
  const highByKey = new Map<string, DriveFile[]>();
  const unparseable: DriveFile[] = [];

  for (const file of highFiles) {
    const prefix = parseDrivePrefix(file.name);
    if (!prefix) {
      unparseable.push(file);
      continue;
    }
    const key = tripleKey(prefix);
    const list = highByKey.get(key);
    if (list) list.push(file);
    else highByKey.set(key, [file]);
  }

  const matched: PrefixMatch[] = [];
  const orphanLow: OrphanLow[] = [];
  const conflictTriples: string[] = [];
  const claimedHighIds = new Set<string>();
  const conflictedHighIds = new Set<string>();

  for (const [filename, triple] of lowMap) {
    const key = tripleKey(triple);
    const candidates = highByKey.get(key);
    if (!candidates || candidates.length === 0) {
      orphanLow.push({ filename, triple });
      continue;
    }
    if (candidates.length >= 2) {
      conflictTriples.push(key);
      orphanLow.push({ filename, triple });
      for (const c of candidates) conflictedHighIds.add(c.id);
      continue;
    }
    const high = candidates[0];
    matched.push({
      lowFilename: filename,
      driveFileId: high.id,
      driveFileName: high.name,
      mimeType: high.mimeType,
    });
    claimedHighIds.add(high.id);
  }

  const orphanHigh: OrphanHigh[] = [];
  for (const file of highFiles) {
    if (claimedHighIds.has(file.id)) continue;
    if (conflictedHighIds.has(file.id)) {
      const prefix = parseDrivePrefix(file.name);
      orphanHigh.push({ file, prefix });
      continue;
    }
    if (unparseable.includes(file)) {
      orphanHigh.push({ file, prefix: null });
      continue;
    }
    // parseable but its triple had no low-res counterpart
    const prefix = parseDrivePrefix(file.name);
    orphanHigh.push({ file, prefix });
  }

  return { matched, orphanLow, orphanHigh, conflictTriples };
}

export interface OrphanBuckets {
  byCategory: Map<number, { lowFilenames: string[]; highFiles: DriveFile[] }>;
  unknownHighRes: DriveFile[];
}

/**
 * Pass 2 準備：把 Pass 1 的孤兒依 categoryId 分桶。
 * - orphanLow 依 triple.categoryId 分組
 * - orphanHigh 依 prefix?.categoryId 分組；prefix=null 進 unknownHighRes（不參與 Vision）
 */
export function bucketOrphansByCategory(
  orphanLow: OrphanLow[],
  orphanHigh: OrphanHigh[],
): OrphanBuckets {
  const byCategory = new Map<number, { lowFilenames: string[]; highFiles: DriveFile[] }>();
  const ensure = (catId: number) => {
    let bucket = byCategory.get(catId);
    if (!bucket) {
      bucket = { lowFilenames: [], highFiles: [] };
      byCategory.set(catId, bucket);
    }
    return bucket;
  };

  for (const o of orphanLow) {
    ensure(o.triple.categoryId).lowFilenames.push(o.filename);
  }

  const unknownHighRes: DriveFile[] = [];
  for (const o of orphanHigh) {
    if (!o.prefix) {
      unknownHighRes.push(o.file);
      continue;
    }
    ensure(o.prefix.categoryId).highFiles.push(o.file);
  }

  return { byCategory, unknownHighRes };
}

export type MatchStrategy =
  | 'prefix-only'
  | 'prefix-with-fallback'
  | 'vision-only'
  | 'skipped-no-drive-images'
  | 'skipped-no-low-res';

/**
 * 從計數器決定 audit log strategy 欄位。判定順序見 spec §6。
 */
export function computeStrategy(input: {
  driveTotal: number;
  lowResTotal: number;
  prefixMatched: number;
  visionAttempted: boolean;
}): MatchStrategy {
  if (input.driveTotal === 0) return 'skipped-no-drive-images';
  if (input.lowResTotal === 0) return 'skipped-no-low-res';
  if (input.prefixMatched > 0 && input.visionAttempted) return 'prefix-with-fallback';
  if (input.prefixMatched === 0 && input.visionAttempted) return 'vision-only';
  return 'prefix-only';
}

export interface CategoryMatchResult {
  replaced: number;
  skipped: number;
  driveFolderId: string;
}

interface VisionMatchEntry {
  storage_filename: string;
  drive_file_id: string;
  drive_file_name: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * 對單一 category 進行 Vision 比對與替換。
 * lowFilenames：該 category 的低解析度檔名（已存在 Storage）
 * highFiles：該 category 對應的 Drive 子資料夾下的高解析度圖
 */
export async function runVisionMatchForCategory(args: {
  weeklyId: number;
  categoryId: number;
  lowFilenames: string[];
  highFiles: DriveFile[];
  providerToken: string;
  onProgress?: (msg: string) => void;
}): Promise<CategoryMatchResult> {
  const { weeklyId, categoryId, lowFilenames, highFiles, providerToken, onProgress } = args;

  if (lowFilenames.length === 0 || highFiles.length === 0) {
    return { replaced: 0, skipped: lowFilenames.length, driveFolderId: '' };
  }

  const tmpDir = join('/tmp', `image-match-${weeklyId}-cat${categoryId}`);
  const lowDir = join(tmpDir, 'low');
  const highDir = join(tmpDir, 'high');

  try {
    mkdirSync(lowDir, { recursive: true });
    mkdirSync(highDir, { recursive: true });

    // Download low-res from Storage
    for (const filename of lowFilenames) {
      const path = `articles/${weeklyId}/images/${filename}`;
      const { data, error } = await getSupabase().storage.from('weekly').download(path);
      if (error) throw new Error(`Storage download error (${filename}): ${error.message}`);
      writeFileSync(join(lowDir, filename), Buffer.from(await data.arrayBuffer()));
    }

    // Download high-res from Drive
    const driveBufferMap = new Map<string, { file: DriveFile; buffer: Buffer }>();
    for (const file of highFiles) {
      const buffer = await downloadFile(providerToken, file.id);
      const safeFilename = `${file.id}_${file.name}`;
      writeFileSync(join(highDir, safeFilename), buffer);
      driveBufferMap.set(file.id, { file, buffer });
    }

    onProgress?.(`category ${categoryId}: AI 比對 ${lowFilenames.length} 張 vs ${highFiles.length} 張`);

    const lowList = lowFilenames.join(', ');
    const highList = highFiles.map((f) => `${f.id}_${f.name}`).join(', ');

    const prompt = `You are an image matching assistant. Match each low-resolution image with its high-resolution original.

## Directories

- Low-resolution images: ${lowDir}/
  Files: ${lowList}

- High-resolution images: ${highDir}/
  Files: ${highList}

## Instructions

CRITICAL: To minimize turns, issue MULTIPLE Read tool calls in parallel (up to 10 per response). Do NOT read images one at a time. After reading all images, output the final JSON in one response.

1. Use Read tool with parallel calls to view images in both directories.
2. Compare visually and match each low-res image to its high-res counterpart.
3. High-res filenames are formatted: {driveFileId}_{originalName}

Output ONLY a JSON array (no other text) when matching is complete:
[{"storage_filename":"image1.png","drive_file_id":"the-drive-id-part-before-underscore","drive_file_name":"originalName.jpg","confidence":"high"}]

Rules:
- confidence: "high" (clearly same image), "medium" (likely same), "low" (uncertain)
- If no match exists, omit that image
- Each high-res image can only match one low-res image`;

    const totalImages = lowFilenames.length + highFiles.length;
    const estimatedTurns = Math.max(20, Math.ceil(totalImages / 3) + 10);

    const result = await runSessionWithStreaming(prompt, {
      weeklyId,
      model: 'opus',
      maxTurns: estimatedTurns,
      allowedTools: ['Read', 'Glob'],
    });

    const jsonMatch = result.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      console.warn(`[image-matcher cat${categoryId}] No JSON in Vision response`);
      return { replaced: 0, skipped: lowFilenames.length, driveFolderId: '' };
    }

    let mappings: VisionMatchEntry[];
    try {
      mappings = JSON.parse(jsonMatch[0]);
    } catch {
      console.warn(`[image-matcher cat${categoryId}] JSON parse error`);
      return { replaced: 0, skipped: lowFilenames.length, driveFolderId: '' };
    }

    let replaced = 0;
    for (const m of mappings) {
      if (m.confidence === 'low') continue;
      const driveImage = driveBufferMap.get(m.drive_file_id);
      if (!driveImage) continue;
      onProgress?.(`category ${categoryId}: 替換 ${m.storage_filename} → ${m.drive_file_name}`);
      const compressed = await compressImage(driveImage.buffer, driveImage.file.mimeType);
      await uploadImage(weeklyId, m.storage_filename, compressed.buffer, compressed.mimeType);
      replaced++;
    }

    return { replaced, skipped: lowFilenames.length - replaced, driveFolderId: '' };
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[image-matcher cat${categoryId}] cleanup failed:`, err);
    }
  }
}

export interface PerCategoryMatchOutcome {
  totalReplaced: number;
  strategy: MatchStrategy;
  prefixMatched: number;
  visionMatched: number;
  driveTotal: number;
  lowResTotal: number;
  orphanLowAfter: string[];
  unparseableHighRes: string[];
  conflictTriples: string[];
}

/**
 * 主入口：prefix-first 兩段式比對。
 * Pass 1：deterministic JOIN via x-x-x.ext prefix
 * Pass 2：Vision fallback per category（沿用 runVisionMatchForCategory）
 */
export async function matchAndReplacePerCategory(options: {
  weeklyId: number;
  parsed: ParsedWeekly;
  providerToken: string;
  driveFolderId: string;
  onProgress?: (msg: string) => void;
}): Promise<PerCategoryMatchOutcome> {
  const { weeklyId, parsed, providerToken, driveFolderId, onProgress } = options;

  const emptyOutcome = (strategy: MatchStrategy, driveTotal: number, lowResTotal: number): PerCategoryMatchOutcome => ({
    totalReplaced: 0,
    strategy,
    prefixMatched: 0,
    visionMatched: 0,
    driveTotal,
    lowResTotal,
    orphanLowAfter: [],
    unparseableHighRes: [],
    conflictTriples: [],
  });

  onProgress?.('列出 Drive 高解析度圖...');
  const highFiles = await listImagesRecursive(providerToken, driveFolderId);
  const lowMap = deriveImageTripleMap(parsed);

  if (highFiles.length === 0) {
    onProgress?.('Drive 沒有任何圖檔，跳過替換');
    return emptyOutcome('skipped-no-drive-images', 0, lowMap.size);
  }
  if (lowMap.size === 0) {
    onProgress?.('Markdown 無圖片引用，跳過替換');
    return emptyOutcome('skipped-no-low-res', highFiles.length, 0);
  }

  onProgress?.(`Pass 1 prefix 比對：${lowMap.size} 張低解析度 vs ${highFiles.length} 張 Drive 圖`);
  const join = joinByTriple(lowMap, highFiles);

  let prefixMatched = 0;
  for (const m of join.matched) {
    onProgress?.(`替換 ${m.lowFilename} ← ${m.driveFileName}`);
    const buffer = await downloadFile(providerToken, m.driveFileId);
    const compressed = await compressImage(buffer, m.mimeType);
    await uploadImage(weeklyId, m.lowFilename, compressed.buffer, compressed.mimeType);
    prefixMatched += 1;
  }

  const buckets = bucketOrphansByCategory(join.orphanLow, join.orphanHigh);
  const visionEligibleCats = [...buckets.byCategory.entries()].filter(
    ([, b]) => b.lowFilenames.length > 0 && b.highFiles.length > 0,
  );
  const visionAttempted = visionEligibleCats.length > 0;

  let visionMatched = 0;
  const matchedLowFilenames = new Set<string>();
  if (visionAttempted) {
    onProgress?.(`Pass 2 Vision fallback：${visionEligibleCats.length} 個分類有漏網圖檔`);
    for (const [catId, bucket] of visionEligibleCats) {
      const result = await runVisionMatchForCategory({
        weeklyId,
        categoryId: catId,
        lowFilenames: bucket.lowFilenames,
        highFiles: bucket.highFiles,
        providerToken,
        onProgress,
      });
      visionMatched += result.replaced;
      // runVisionMatchForCategory doesn't return which specific files matched,
      // so for orphanLowAfter we conservatively keep all orphan low filenames
      // and subtract the count below. Use bucket size when fully replaced; else leave all.
      if (result.replaced === bucket.lowFilenames.length) {
        for (const fn of bucket.lowFilenames) matchedLowFilenames.add(fn);
      }
    }
  }

  const orphanLowAfter = join.orphanLow
    .map((o) => o.filename)
    .filter((fn) => !matchedLowFilenames.has(fn));

  const strategy = computeStrategy({
    driveTotal: highFiles.length,
    lowResTotal: lowMap.size,
    prefixMatched,
    visionAttempted,
  });

  return {
    totalReplaced: prefixMatched + visionMatched,
    strategy,
    prefixMatched,
    visionMatched,
    driveTotal: highFiles.length,
    lowResTotal: lowMap.size,
    orphanLowAfter,
    unparseableHighRes: buckets.unknownHighRes.map((f) => f.name),
    conflictTriples: join.conflictTriples,
  };
}
