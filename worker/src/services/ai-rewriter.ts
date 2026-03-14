import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runSessionWithStreaming } from './session-streamer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const IMAGE_REGEX = /!\[[^\]]*\]\([^)]+\)/g;

/**
 * 提取 markdown 中的所有圖片語法
 */
function extractImages(markdown: string): string[] {
  return markdown.match(IMAGE_REGEX) || [];
}

/**
 * 確保原稿中的所有圖片都保留在改寫後的內容中
 * 如果有缺漏，自動補回到內容末尾
 */
function ensureImagesPreserved(originalContent: string, rewrittenContent: string): string {
  const originalImages = extractImages(originalContent);
  if (originalImages.length === 0) return rewrittenContent;

  const missingImages = originalImages.filter(img => !rewrittenContent.includes(img));

  if (missingImages.length === 0) return rewrittenContent;

  console.log(`[AI Rewriter] 補回 ${missingImages.length} 張遺漏圖片（原稿 ${originalImages.length} 張）`);
  return rewrittenContent + '\n\n' + missingImages.join('\n\n');
}

interface RewrittenArticle {
  title: string;
  description: string;
  content: string;
}

async function loadSkill(skillName: string): Promise<string> {
  const skillPath = join(__dirname, '../../../.claude/skills', `${skillName}.md`);
  return readFile(skillPath, 'utf-8');
}

export async function rewriteForDigital(
  originalTitle: string,
  originalContent: string,
  weeklyId: number,
  categoryName: string
): Promise<RewrittenArticle> {
  const skill = await loadSkill('rewrite-for-digital');

  const prompt = `${skill}

---

請將以下週報原稿改寫為數位版內容。

## 分類
${categoryName}

只輸出 JSON 格式：
{
  "title": "改寫後的標題",
  "description": "50-100字的文章摘要，適合用於 meta description 和社群分享",
  "content": "改寫後的 markdown 內容"
}

不要有其他文字。

---

## 原稿標題
${originalTitle}

## 原稿內容
${originalContent}`;

  // 使用 session streaming，即時廣播進度
  const resultText = await runSessionWithStreaming(prompt, {
    weeklyId,
    model: 'claude-sonnet-4-20250514',
  });

  if (!resultText) {
    throw new Error('No result from AI');
  }

  // 提取 JSON
  let jsonStr = resultText;
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  try {
    const result = JSON.parse(jsonStr.trim()) as RewrittenArticle;
    if (!result.title || !result.content) {
      throw new Error('AI rewrite response missing required fields: title, content');
    }

    // 程式化驗證：確保原稿所有圖片都保留在改寫內容中
    result.content = ensureImagesPreserved(originalContent, result.content);

    return result;
  } catch (e) {
    throw new Error(`Failed to parse AI rewrite response as JSON: ${e}`);
  }
}

export async function generateDescription(
  title: string,
  content: string,
  categoryName: string
): Promise<string> {
  const prompt = `你是一個專業的文章摘要生成器。請為以下慈濟週報文章生成一段 50-100 字的中文摘要。

## 要求
- 長度：50-100 字（中文）
- 內容：概括文章核心訊息，回答「這篇文章在講什麼」
- 用途：SEO meta description、社群分享卡片、文章列表預覽
- 風格：完整句子，吸引點擊但不標題黨
- 保持慈濟溫暖人文的語調

## 分類
${categoryName}

## 文章標題
${title}

## 文章內容
${content.substring(0, 2000)}

請直接輸出摘要文字，不要有任何前綴或說明。`;

  const resultText = await runSessionWithStreaming(prompt, {
    weeklyId: 0,
    model: 'claude-sonnet-4-20250514',
  });

  if (!resultText) {
    throw new Error('No result from AI');
  }

  // 清理可能的引號或多餘空白
  return resultText.trim().replace(/^["']|["']$/g, '');
}

export async function rewriteAllArticles(
  articles: Array<{ title: string; content: string; categoryName: string }>,
  weeklyId: number,
  onProgress?: (current: number, total: number) => void
): Promise<RewrittenArticle[]> {
  const results: RewrittenArticle[] = [];

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    onProgress?.(i + 1, articles.length);

    const rewritten = await rewriteForDigital(article.title, article.content, weeklyId, article.categoryName);
    results.push(rewritten);
  }

  return results;
}
