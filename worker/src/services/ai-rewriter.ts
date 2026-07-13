import { runSessionWithStreaming } from './session-streamer.js';
import { loadSkillSystemPrompt } from './skill-loader.js';

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

export async function rewriteForDigital(
  originalTitle: string,
  originalContent: string,
  weeklyId: number,
  categoryName: string
): Promise<RewrittenArticle> {
  const systemPrompt = await loadSkillSystemPrompt('rewrite-for-digital');

  const userPrompt = `請將以下週報原稿改寫為數位版內容。

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

  const resultText = await runSessionWithStreaming(userPrompt, {
    weeklyId,
    model: 'opus',
    systemPrompt,
    logTag: 'rewrite-for-digital',
  });

  if (!resultText) {
    throw new Error('No result from AI');
  }

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
  const systemPrompt = await loadSkillSystemPrompt('generate-description');

  const userPrompt = `## 分類
${categoryName}

## 文章標題
${title}

## 文章內容
${content.substring(0, 2000)}`;

  const resultText = await runSessionWithStreaming(userPrompt, {
    weeklyId: 0,
    model: 'opus',
    systemPrompt,
    logTag: 'generate-description',
  });

  if (!resultText) {
    throw new Error('No result from AI');
  }

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
