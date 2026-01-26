import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
  anthropic: Anthropic,
  originalTitle: string,
  originalContent: string
): Promise<RewrittenArticle> {
  const skill = await loadSkill('rewrite-for-digital');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: `${skill}

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
${originalContent}`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type');
  }

  // 提取 JSON
  let jsonStr = content.text;
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
  anthropic: Anthropic,
  articles: Array<{ title: string; content: string }>,
  onProgress?: (current: number, total: number) => void
): Promise<RewrittenArticle[]> {
  const results: RewrittenArticle[] = [];

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    onProgress?.(i + 1, articles.length);

    const rewritten = await rewriteForDigital(anthropic, article.title, article.content);
    results.push(rewritten);
  }

  return results;
}
