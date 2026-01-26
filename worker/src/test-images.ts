import { readFile } from 'fs/promises';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

// 處理 Google Docs 匯出的 reference-style 圖片
const REFERENCE_IMAGE_DEF_REGEX = /\[([^\]]+)\]:\s*<?data:(image\/[^;]+);base64,([^\s>]+)>?/g;
const REFERENCE_IMAGE_USE_REGEX = /!\[([^\]]*)\]\[([^\]]+)\]/g;

function getMimeExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  return map[mimeType] || 'png';
}

async function testImageExtraction(filePath: string) {
  console.log('讀取檔案...');
  const markdown = await readFile(filePath, 'utf-8');
  console.log(`檔案大小: ${(markdown.length / 1024 / 1024).toFixed(2)} MB`);

  // 收集 reference 定義
  const definitions: Map<string, { mimeType: string; base64: string }> = new Map();
  let match;

  while ((match = REFERENCE_IMAGE_DEF_REGEX.exec(markdown)) !== null) {
    definitions.set(match[1], {
      mimeType: match[2],
      base64: match[3],
    });
  }

  console.log(`\n找到 ${definitions.size} 個圖片定義:`);

  // 建立輸出目錄
  const outputDir = '/Users/kaellim/Desktop/projects/library/worker/test-output';
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  // 轉換並儲存圖片
  let index = 1;
  for (const [refId, { mimeType, base64 }] of definitions) {
    const ext = getMimeExtension(mimeType);
    const filename = `${refId}.${ext}`;
    const buffer = Buffer.from(base64, 'base64');

    console.log(`  ${index}. ${refId}: ${mimeType}, ${(buffer.length / 1024).toFixed(1)} KB`);

    await writeFile(`${outputDir}/${filename}`, buffer);
    index++;
  }

  console.log(`\n圖片已儲存至: ${outputDir}`);

  // 測試替換
  let processedMarkdown = markdown;

  // 替換 reference-style 圖片為 inline 格式
  processedMarkdown = processedMarkdown.replace(
    REFERENCE_IMAGE_USE_REGEX,
    (fullMatch, altText, refId) => {
      if (definitions.has(refId)) {
        return `![${altText}](https://bucket-url/${refId}.png)`;
      }
      return fullMatch;
    }
  );

  // 移除 reference 定義
  processedMarkdown = processedMarkdown.replace(REFERENCE_IMAGE_DEF_REGEX, '');
  processedMarkdown = processedMarkdown.trim();

  // 儲存處理後的 markdown
  await writeFile(`${outputDir}/processed.md`, processedMarkdown);
  console.log(`處理後的 markdown 已儲存至: ${outputDir}/processed.md`);
  console.log(`處理後大小: ${(processedMarkdown.length / 1024).toFixed(1)} KB`);
}

const filePath = process.argv[2] || '/Users/kaellim/Downloads/慈濟週報第117期 文件.md';
testImageExtraction(filePath).catch(console.error);
