import { uploadImage } from './supabase.js';

interface ImageMatch {
  fullMatch: string;
  base64Data: string;
  mimeType: string;
  altText: string;
}

// 匹配 markdown 中的 base64 圖片
// 格式: ![alt](data:image/png;base64,xxxxx) 或 reference style
const BASE64_IMAGE_REGEX = /!\[([^\]]*)\]\(data:(image\/[^;]+);base64,([^)]+)\)/g;

export function findBase64Images(markdown: string): ImageMatch[] {
  const matches: ImageMatch[] = [];
  let match;

  BASE64_IMAGE_REGEX.lastIndex = 0;
  while ((match = BASE64_IMAGE_REGEX.exec(markdown)) !== null) {
    matches.push({
      fullMatch: match[0],
      altText: match[1],
      mimeType: match[2],
      base64Data: match[3],
    });
  }

  return matches;
}

export function base64ToBuffer(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

export function getMimeExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
  };
  return map[mimeType] || 'png';
}

export async function processAndUploadImages(
  markdown: string,
  weeklyId: number
): Promise<string> {
  const images = findBase64Images(markdown);
  let processedMarkdown = markdown;

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const ext = getMimeExtension(image.mimeType);
    const filename = `image${i + 1}.${ext}`;

    const buffer = base64ToBuffer(image.base64Data);
    const url = await uploadImage(weeklyId, filename, buffer, image.mimeType);

    // 替換 base64 為 URL
    processedMarkdown = processedMarkdown.replace(
      image.fullMatch,
      `![${image.altText}](${url})`
    );
  }

  return processedMarkdown;
}

// 處理 Google Docs 匯出的 reference-style 圖片
// 格式: ![][image1] ... [image1]: <data:image/png;base64,xxxxx>
const REFERENCE_IMAGE_DEF_REGEX = /\[([^\]]+)\]:\s*<?data:(image\/[^;]+);base64,([^\s>]+)>?/g;
const REFERENCE_IMAGE_USE_REGEX = /!\[([^\]]*)\]\[([^\]]+)\]/g;

export async function processReferenceStyleImages(
  markdown: string,
  weeklyId: number
): Promise<string> {
  // 先收集所有 reference 定義
  const definitions: Map<string, { mimeType: string; base64: string }> = new Map();
  let match;

  REFERENCE_IMAGE_DEF_REGEX.lastIndex = 0;
  while ((match = REFERENCE_IMAGE_DEF_REGEX.exec(markdown)) !== null) {
    definitions.set(match[1], {
      mimeType: match[2],
      base64: match[3],
    });
  }

  // 上傳圖片並建立 URL 映射
  const urlMap: Map<string, string> = new Map();
  let imageIndex = 1;

  for (const [refId, { mimeType, base64 }] of definitions) {
    const ext = getMimeExtension(mimeType);
    const filename = `image${imageIndex}.${ext}`;
    const buffer = base64ToBuffer(base64);
    const url = await uploadImage(weeklyId, filename, buffer, mimeType);
    urlMap.set(refId, url);
    imageIndex++;
  }

  // 替換 reference-style 圖片為 inline 格式
  let processedMarkdown = markdown.replace(
    REFERENCE_IMAGE_USE_REGEX,
    (fullMatch, altText, refId) => {
      const url = urlMap.get(refId);
      if (url) {
        return `![${altText}](${url})`;
      }
      return fullMatch;
    }
  );

  // 移除 reference 定義
  processedMarkdown = processedMarkdown.replace(REFERENCE_IMAGE_DEF_REGEX, '');

  return processedMarkdown.trim();
}

// 綜合處理：先處理 reference-style，再處理 inline base64
export async function processAllImages(
  markdown: string,
  weeklyId: number
): Promise<string> {
  let processed = await processReferenceStyleImages(markdown, weeklyId);
  processed = await processAndUploadImages(processed, weeklyId);
  return processed;
}
