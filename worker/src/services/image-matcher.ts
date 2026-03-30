import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { downloadFile, listImagesRecursive, type DriveFile } from './google-drive.js';
import { runSessionWithStreaming } from './session-streamer.js';
import { getSupabase, uploadImage } from './supabase.js';
import { compressImage } from './image-compressor.js';

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

1. Use the Read tool to view each image in both directories
2. Compare them visually and match each low-res image to its high-res counterpart
3. The high-res filenames are formatted as: {driveFileId}_{originalName}

Output ONLY a JSON array (no other text):
[{"storage_filename":"image1.png","drive_file_id":"the-drive-id-part-before-underscore","drive_file_name":"originalName.jpg","confidence":"high"}]

Rules:
- confidence: "high" (clearly same image), "medium" (likely same), "low" (uncertain)
- If no match exists, omit that image
- Each Drive image can only match one Storage image`;

    const result = await runSessionWithStreaming(prompt, {
      weeklyId,
      model: 'claude-sonnet-4-20250514',
      maxTurns: 30,
      allowedTools: ['Read', 'Glob'],
    });

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
