import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

/**
 * 讀取 Google Docs 匯出的 markdown 檔案
 *
 * 目前支援：本地檔案路徑
 *
 * 未來可擴充：
 * - Google Docs API 直接匯出
 * - 公開分享連結
 */
export async function loadMarkdownFromFile(filePath: string): Promise<string> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = await readFile(filePath, 'utf-8');
  return content;
}

/**
 * 從檔案名稱或內容提取 weekly_id
 * 例如：慈濟週報第117期 文件.md → 117
 */
export function extractWeeklyId(filename: string, content?: string): number | null {
  // 從檔名提取
  const filenameMatch = filename.match(/第(\d+)期/);
  if (filenameMatch) {
    return parseInt(filenameMatch[1], 10);
  }

  // 從內容提取（如果有）
  if (content) {
    const contentMatch = content.match(/第(\d+)期/);
    if (contentMatch) {
      return parseInt(contentMatch[1], 10);
    }
  }

  return null;
}

/**
 * 從 Google Docs URL 提取文件 ID
 * 例如：https://docs.google.com/document/d/ABC123/edit → ABC123
 */
export function extractDocId(url: string): string | null {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * 構建 Google Docs 匯出 URL
 */
export function buildExportUrl(docId: string): string {
  return `https://docs.google.com/document/d/${docId}/export?format=md`;
}
