import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runSessionWithStreaming } from './session-streamer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface RewrittenArticle {
  title: string;
  content: string;
}

async function loadSkill(skillName: string): Promise<string> {
  const skillPath = join(__dirname, '../../../.claude/skills', `${skillName}.md`);
  return readFile(skillPath, 'utf-8');
}

export async function rewriteForDigital(
  originalTitle: string,
  originalContent: string,
  weeklyId: number
): Promise<RewrittenArticle> {
  const skill = await loadSkill('rewrite-for-digital');

  const prompt = `${skill}

---

請將以下週報原稿改寫為數位版內容。

只輸出 JSON 格式：
{
  "title": "改寫後的標題",
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
    return JSON.parse(jsonStr.trim()) as RewrittenArticle;
  } catch (e) {
    throw new Error(`Failed to parse AI rewrite response as JSON: ${e}`);
  }
}

export async function rewriteAllArticles(
  articles: Array<{ title: string; content: string }>,
  weeklyId: number,
  onProgress?: (current: number, total: number) => void
): Promise<RewrittenArticle[]> {
  const results: RewrittenArticle[] = [];

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    onProgress?.(i + 1, articles.length);

    const rewritten = await rewriteForDigital(article.title, article.content, weeklyId);
    results.push(rewritten);
  }

  return results;
}
