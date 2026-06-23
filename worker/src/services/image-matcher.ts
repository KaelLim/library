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
import type { ParsedWeekly } from '../types/index.js';

interface MatchResult {
  storage_filename: string;
  drive_file_id: string;
  drive_file_name: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * 從 markdown 提取已上傳的圖片檔名
 * 格式: ![alt](/storage/v1/object/public/weekly/articles/{weeklyId}/images/image1.png)
 */
function extractImageFilenames(markdown: string): string[] {
  const regex = /!\[[^\]]*\]\([^)]*\/images\/(image\d+\.\w+)\)/g;
  const filenames: string[] = [];
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    if (!filenames.includes(match[1])) {
      filenames.push(match[1]);
    }
  }
  return filenames;
}

/**
 * 從 Supabase Storage 下載圖片
 */
async function downloadStorageImage(weeklyId: number, filename: string): Promise<Buffer> {
  const path = `articles/${weeklyId}/images/${filename}`;
  const { data, error } = await getSupabase().storage.from('weekly').download(path);
  if (error) throw new Error(`Storage download error: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

/**
 * 使用 Claude Vision 比對低解析度與高解析度圖片，然後替換 Storage 中的圖片
 *
 * 流程：
 * 1. 從 markdown 提取 Storage 圖片檔名
 * 2. 從 Drive 列出並下載高解析度圖片
 * 3. 存到 /tmp，讓 Claude Agent SDK 用 Read tool 讀取比對
 * 4. 用高解析度圖片替換 Storage 中的低解析度版本
 * 5. 清理 /tmp
 *
 * 注意：使用 allowedTools: ['Read'] 而非 bypassPermissions（後者在 Docker 會 crash）
 */
export async function matchAndReplaceImages(options: {
  weeklyId: number;
  markdown: string;
  providerToken: string;
  driveFolderId: string;
  onProgress?: (msg: string) => void;
}): Promise<number> {
  const { weeklyId, markdown, providerToken, driveFolderId, onProgress } = options;

  const tmpDir = join('/tmp', `image-match-${weeklyId}`);
  const lowDir = join(tmpDir, 'low');
  const highDir = join(tmpDir, 'high');

  try {
    // 1. 提取 Storage 圖片檔名
    const storageFilenames = extractImageFilenames(markdown);
    if (storageFilenames.length === 0) {
      onProgress?.('沒有找到圖片，跳過');
      return 0;
    }

    // 2. 列出 Drive 圖片
    onProgress?.('讀取 Drive 資料夾...');
    const driveFiles = await listImagesRecursive(providerToken, driveFolderId);
    if (driveFiles.length === 0) {
      onProgress?.('Drive 資料夾沒有圖片，跳過');
      return 0;
    }

    // 3. 下載並存到 /tmp
    onProgress?.(
      `下載 ${storageFilenames.length} 張低解析度 + ${driveFiles.length} 張高解析度圖片...`
    );

    mkdirSync(lowDir, { recursive: true });
    mkdirSync(highDir, { recursive: true });

    // 下載低解析度圖片到 /tmp/image-match-{id}/low/
    for (const filename of storageFilenames) {
      const buffer = await downloadStorageImage(weeklyId, filename);
      writeFileSync(join(lowDir, filename), buffer);
    }

    // 下載高解析度圖片到 /tmp/image-match-{id}/high/
    // 檔名加上 Drive file ID 以便後續對應
    const driveFileMap = new Map<string, { file: DriveFile; buffer: Buffer }>();
    for (const file of driveFiles) {
      const buffer = await downloadFile(providerToken, file.id);
      const safeFilename = `${file.id}_${file.name}`;
      writeFileSync(join(highDir, safeFilename), buffer);
      driveFileMap.set(file.id, { file, buffer });
    }

    // 4. 讓 Claude Agent SDK 用 Read tool 讀取 /tmp 圖片進行比對
    onProgress?.('AI 圖片比對中...');

    const lowFiles = storageFilenames.join(', ');
    const highFiles = driveFiles.map((f) => `${f.id}_${f.name}`).join(', ');

    const prompt = `You are an image matching assistant. Your task is to match low-resolution images with their high-resolution originals.

## Directories

- Low-resolution images (from Google Doc): ${lowDir}/
  Files: ${lowFiles}

- High-resolution images (from Google Drive): ${highDir}/
  Files: ${highFiles}

## Instructions

CRITICAL: To minimize turns, **read images in parallel batches**:
- Issue MULTIPLE Read tool calls in a single response (parallel tool use).
- Recommended: read up to 10 images per response. Do NOT read one at a time.
- After reading all images, output the final JSON in one response.

1. Use the Read tool with parallel calls to view images in both directories.
2. Compare them visually and match each low-res image to its high-res counterpart.
3. The high-res filenames are formatted as: {driveFileId}_{originalName}

Output ONLY a JSON array (no other text) when matching is complete:
[{"storage_filename":"image1.png","drive_file_id":"the-drive-id-part-before-underscore","drive_file_name":"originalName.jpg","confidence":"high"}]

Rules:
- confidence: "high" (clearly same image), "medium" (likely same), "low" (uncertain)
- If no match exists, omit that image
- Each Drive image can only match one Storage image`;

    // maxTurns 預估：每回合可平行讀 ~5-10 張，加緩衝。
    // 即使 Claude 未完全平行（每回合 3 張），公式仍夠用。
    const totalImages = storageFilenames.length + driveFiles.length;
    const estimatedTurns = Math.max(60, Math.ceil(totalImages / 3) + 20);

    const result = await runSessionWithStreaming(prompt, {
      weeklyId,
      model: 'opus',
      maxTurns: estimatedTurns,
      allowedTools: ['Read', 'Glob'],
    });

    console.log(`[ImageMatcher] Used maxTurns=${estimatedTurns} for ${storageFilenames.length} low + ${driveFiles.length} high images`);

    console.log('[ImageMatcher] AI result length:', result.length);
    console.log('[ImageMatcher] AI result preview:', result.substring(0, 300));

    // 解析結果
    const jsonMatch = result.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      console.warn('[ImageMatcher] No valid JSON in Claude response:', result.substring(0, 200));
      onProgress?.('AI 比對結果無法解析，跳過替換');
      return 0;
    }

    let mappings: MatchResult[];
    try {
      mappings = JSON.parse(jsonMatch[0]);
    } catch {
      console.warn('[ImageMatcher] JSON parse error');
      onProgress?.('AI 比對結果格式錯誤，跳過替換');
      return 0;
    }

    console.log('[ImageMatcher] Parsed mappings:', JSON.stringify(mappings));

    // 5. 替換圖片（只替換 high/medium confidence）
    let replaced = 0;
    for (const mapping of mappings) {
      if (mapping.confidence === 'low') {
        console.log(`[ImageMatcher] Skipping low confidence: ${mapping.storage_filename}`);
        continue;
      }

      const driveImage = driveFileMap.get(mapping.drive_file_id);
      if (!driveImage) {
        console.warn(`[ImageMatcher] Drive file not found: ${mapping.drive_file_id}`);
        continue;
      }

      onProgress?.(`替換 ${mapping.storage_filename} → ${mapping.drive_file_name}`);
      const compressed = await compressImage(driveImage.buffer, driveImage.file.mimeType);
      await uploadImage(
        weeklyId,
        mapping.storage_filename,
        compressed.buffer,
        compressed.mimeType
      );
      replaced++;
    }

    return replaced;
  } finally {
    // 6. 清理 /tmp
    try {
      rmSync(tmpDir, { recursive: true, force: true });
      console.log(`[ImageMatcher] Cleaned up ${tmpDir}`);
    } catch (err) {
      console.warn(`[ImageMatcher] Failed to cleanup ${tmpDir}:`, err);
    }
  }
}

const IMAGE_FILENAME_REGEX = /\/images\/(image\d+\.\w+)\)/g;

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
