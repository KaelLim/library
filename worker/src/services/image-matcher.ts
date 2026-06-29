import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import {
  downloadFile,
  listImagesRecursive,
  listFiles,
  filterSubfolders,
  type DriveFile,
  type DriveSubfolder,
} from './google-drive.js';
import { runSessionWithStreaming } from './session-streamer.js';
import { getSupabase, uploadImage } from './supabase.js';
import { compressImage } from './image-compressor.js';
import { extractJsonObject } from './ai-parser.js';
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

/**
 * 從 parse 結果推導每張低解析度圖對應的 category_id。
 * 同一檔名出現在多版時，第一次出現的 category 勝出（regex 順序）。
 */
export function deriveImageCategoryMap(parsed: ParsedWeekly): Map<string, number> {
  const map = new Map<string, number>();
  for (const category of parsed.categories) {
    for (const article of category.articles) {
      IMAGE_FILENAME_REGEX.lastIndex = 0;
      let match;
      while ((match = IMAGE_FILENAME_REGEX.exec(article.content)) !== null) {
        const filename = match[1];
        if (!map.has(filename)) {
          map.set(filename, category.category_id);
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

export type DriveStructure =
  | { mode: 'categorized'; subfolders: DriveSubfolder[] }
  | { mode: 'flat'; reason: string };

/**
 * 純函式：給 root 資料夾的直接子項清單，決定結構是 categorized 還是 flat。
 */
export function decideDriveStructure(files: DriveFile[]): DriveStructure {
  const subfolders = filterSubfolders(files);
  const rootImages = files.filter((f) => f.mimeType.startsWith('image/'));

  if (subfolders.length < 2) {
    return { mode: 'flat', reason: `子資料夾不足（${subfolders.length}）` };
  }
  if (rootImages.length > 0) {
    return { mode: 'flat', reason: `根目錄混有 ${rootImages.length} 張圖檔` };
  }
  return { mode: 'categorized', subfolders };
}

/**
 * IO 包裝：呼叫 Drive API 取得 root 子項，然後交給 decideDriveStructure 判斷。
 */
export async function detectDriveStructure(
  token: string,
  rootFolderId: string,
): Promise<DriveStructure> {
  const files = await listFiles(token, rootFolderId);
  return decideDriveStructure(files);
}

export interface FolderCategoryMapping {
  mappings: Map<string, number>;
  unmapped: string[];
}

const CATEGORY_TABLE = [
  { id: 1, name: '全球焦點' },
  { id: 2, name: '證嚴上人開示' },
  { id: 3, name: '慈濟要聞' },
  { id: 4, name: '慈善志業要聞' },
  { id: 5, name: '里仁為美' },
  { id: 6, name: '大醫行願' },
  { id: 7, name: '春風化雨' },
  { id: 8, name: '人文馨香' },
];

/**
 * 純函式：根據子資料夾清單組出給 AI 的 prompt。
 */
export function buildFolderMappingPrompt(subfolders: DriveSubfolder[]): string {
  const tableLines = CATEGORY_TABLE.map((c) => `| ${c.id} | ${c.name} |`).join('\n');
  const folderLines = subfolders.map((f) => `- ${f.id}: "${f.name}"`).join('\n');

  return `你要把 Google Drive 子資料夾名稱對應到慈濟週報的 8 個固定 category_id。

對照表（必須使用其中之一，不可新建）：
| category_id | name |
|-------------|------|
${tableLines}

子資料夾命名可能包含版次（一版/二版/...）、分類名稱、狀態標記（完稿/定稿）等變體。請語意判斷，每個 folder_id 對應一個 category_id (1-8)；同一 category_id 不可被多個 folder 同時對到。無法判斷請列入 unmapped。

子資料夾清單：
${folderLines}

CRITICAL OUTPUT CONTRACT:
- 整段回應必須是單一 JSON 物件，第一個字元 \`{\`，最後一個字元 \`}\`。
- 不可有 prose、code fence、說明文字。

輸出格式：
{"mappings":[{"folder_id":"...","category_id":1},...],"unmapped":["folder_id_x",...]}`;
}

/**
 * 純函式：驗證 AI 回傳的 mapping，回傳安全的對應表。
 * - category_id 超出 1-8 → unmapped
 * - 重複的 category_id → 所有衝突 folder 全進 unmapped
 * - AI 漏掉的 folder_id → unmapped
 */
export function validateFolderMappingResponse(
  raw: unknown,
  allFolderIds: string[],
): FolderCategoryMapping {
  const empty: FolderCategoryMapping = { mappings: new Map(), unmapped: [...allFolderIds] };
  if (!raw || typeof raw !== 'object') return empty;
  const rawObj = raw as { mappings?: unknown; unmapped?: unknown };
  const rawMappings = Array.isArray(rawObj.mappings) ? rawObj.mappings : [];
  const rawUnmapped = Array.isArray(rawObj.unmapped) ? rawObj.unmapped : [];

  // Phase 1: collect valid (folder_id, category_id) pairs
  const candidates: Array<{ folder_id: string; category_id: number }> = [];
  const explicitlyUnmapped = new Set<string>();
  for (const u of rawUnmapped) {
    if (typeof u === 'string') explicitlyUnmapped.add(u);
  }

  for (const entry of rawMappings) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { folder_id?: unknown; category_id?: unknown };
    if (typeof e.folder_id !== 'string') continue;
    if (typeof e.category_id !== 'number' || !Number.isInteger(e.category_id)) continue;
    if (e.category_id < 1 || e.category_id > 8) continue;
    if (!allFolderIds.includes(e.folder_id)) continue;
    if (explicitlyUnmapped.has(e.folder_id)) continue;
    candidates.push({ folder_id: e.folder_id, category_id: e.category_id });
  }

  // Phase 2: detect category_id collisions; collisions exclude ALL involved folders
  const categoryCount = new Map<number, number>();
  for (const c of candidates) {
    categoryCount.set(c.category_id, (categoryCount.get(c.category_id) ?? 0) + 1);
  }
  const mappings = new Map<string, number>();
  const collisionFolders = new Set<string>();
  for (const c of candidates) {
    if ((categoryCount.get(c.category_id) ?? 0) > 1) {
      collisionFolders.add(c.folder_id);
    } else {
      mappings.set(c.folder_id, c.category_id);
    }
  }

  // Phase 3: build unmapped — every folder not in mappings
  const unmapped = allFolderIds.filter((id) => !mappings.has(id));

  return { mappings, unmapped };
}

/**
 * 呼叫 AI 將 Drive 子資料夾名稱對應到 category_id (1-8)。
 * AI 回傳 JSON 後經 validateFolderMappingResponse 嚴格驗證。
 */
export async function mapDriveFoldersToCategories(
  subfolders: DriveSubfolder[],
  weeklyId: number,
): Promise<FolderCategoryMapping> {
  if (subfolders.length === 0) {
    return { mappings: new Map(), unmapped: [] };
  }

  const prompt = buildFolderMappingPrompt(subfolders);
  const resultText = await runSessionWithStreaming(prompt, {
    weeklyId,
    model: 'opus',
  });

  if (!resultText) {
    console.error('[image-matcher] folder mapping: empty AI response');
    return { mappings: new Map(), unmapped: subfolders.map((f) => f.id) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(resultText));
  } catch (err) {
    console.error('[image-matcher] folder mapping: JSON parse failed');
    console.error('AI response preview (first 500 chars):', resultText.substring(0, 500));
    return { mappings: new Map(), unmapped: subfolders.map((f) => f.id) };
  }

  return validateFolderMappingResponse(
    parsed,
    subfolders.map((f) => f.id),
  );
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
  perCategory: Record<number, CategoryMatchResult>;
  strategy: 'per-category' | 'skipped-flat' | 'skipped-mapping-failed';
  folderMapping: Record<string, number>;
  unmappedFolders: string[];
  driveStructure:
    | { mode: 'categorized'; subfoldersCount: number }
    | { mode: 'flat'; reason: string };
}

/**
 * 主入口：分類別逐版比對。失敗時嚴格 fallback（跳過替換，保留低解析度）。
 */
export async function matchAndReplacePerCategory(options: {
  weeklyId: number;
  parsed: ParsedWeekly;
  providerToken: string;
  driveFolderId: string;
  onProgress?: (msg: string) => void;
}): Promise<PerCategoryMatchOutcome> {
  const { weeklyId, parsed, providerToken, driveFolderId, onProgress } = options;

  onProgress?.('偵測 Drive 結構...');
  const structure = await detectDriveStructure(providerToken, driveFolderId);

  if (structure.mode === 'flat') {
    onProgress?.(`Drive 為平鋪結構（${structure.reason}），跳過高解析度替換`);
    return {
      totalReplaced: 0,
      perCategory: {},
      strategy: 'skipped-flat',
      folderMapping: {},
      unmappedFolders: [],
      driveStructure: structure,
    };
  }

  onProgress?.(`AI 對應 ${structure.subfolders.length} 個子資料夾到分類...`);
  const mapping = await mapDriveFoldersToCategories(structure.subfolders, weeklyId);

  if (mapping.mappings.size === 0) {
    onProgress?.('AI 無法對應任何子資料夾到分類，跳過');
    return {
      totalReplaced: 0,
      perCategory: {},
      strategy: 'skipped-mapping-failed',
      folderMapping: {},
      unmappedFolders: mapping.unmapped,
      driveStructure: { mode: 'categorized', subfoldersCount: structure.subfolders.length },
    };
  }

  const imageToCategory = deriveImageCategoryMap(parsed);
  const categoryToImages = new Map<number, string[]>();
  for (const [filename, catId] of imageToCategory) {
    if (!categoryToImages.has(catId)) categoryToImages.set(catId, []);
    categoryToImages.get(catId)!.push(filename);
  }

  const folderByCategory = new Map<number, string>();
  for (const [folderId, catId] of mapping.mappings) {
    folderByCategory.set(catId, folderId);
  }

  const perCategory: Record<number, CategoryMatchResult> = {};
  let totalReplaced = 0;

  for (const [catId, lowFilenames] of categoryToImages) {
    const folderId = folderByCategory.get(catId);
    if (!folderId) {
      onProgress?.(`分類 ${catId} 無對應 Drive 子資料夾，跳過 ${lowFilenames.length} 張`);
      perCategory[catId] = { replaced: 0, skipped: lowFilenames.length, driveFolderId: '' };
      continue;
    }

    onProgress?.(`分類 ${catId}: 列出 Drive 高解析度圖...`);
    const highFiles = await listImagesRecursive(providerToken, folderId);
    if (highFiles.length === 0) {
      onProgress?.(`分類 ${catId} 的 Drive 資料夾沒有圖片`);
      perCategory[catId] = { replaced: 0, skipped: lowFilenames.length, driveFolderId: folderId };
      continue;
    }

    const result = await runVisionMatchForCategory({
      weeklyId,
      categoryId: catId,
      lowFilenames,
      highFiles,
      providerToken,
      onProgress,
    });
    perCategory[catId] = { ...result, driveFolderId: folderId };
    totalReplaced += result.replaced;
  }

  const folderMapping: Record<string, number> = {};
  for (const [folderId, catId] of mapping.mappings) {
    folderMapping[folderId] = catId;
  }

  return {
    totalReplaced,
    perCategory,
    strategy: 'per-category',
    folderMapping,
    unmappedFolders: mapping.unmapped,
    driveStructure: { mode: 'categorized', subfoldersCount: structure.subfolders.length },
  };
}
