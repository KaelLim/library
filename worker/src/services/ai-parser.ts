import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ParsedWeekly } from '../types/index.js';
import { runSessionWithStreaming } from './session-streamer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadSkill(skillName: string): Promise<string> {
  const skillPath = join(__dirname, '../../../.claude/skills', `${skillName}.md`);
  return readFile(skillPath, 'utf-8');
}

export async function parseWeeklyMarkdown(
  markdown: string,
  weeklyId: number
): Promise<ParsedWeekly> {
  const skill = await loadSkill('parse-weekly');

  const prompt = `${skill}

---

請解析以下週報 markdown 檔案（weekly_id: ${weeklyId}），輸出結構化 JSON。

只輸出 JSON，不要有其他文字。

---

${markdown}`;

  // 使用 session streaming，即時廣播進度
  const resultText = await runSessionWithStreaming(prompt, {
    weeklyId,
    model: 'claude-sonnet-4-20250514',
  });

  if (!resultText) {
    throw new Error('No result from AI');
  }

  // 提取 JSON（可能被包在 code block 中）
  let jsonStr = resultText;
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  try {
    const parsed = JSON.parse(jsonStr.trim()) as ParsedWeekly;
    parsed.weekly_id = weeklyId; // 確保 weekly_id 正確
    return parsed;
  } catch (e) {
    throw new Error(`Failed to parse AI response as JSON: ${e}`);
  }
}

export async function generateCleanMarkdown(
  originalMarkdown: string,
  parsed: ParsedWeekly
): Promise<string> {
  // 根據解析結果重新生成乾淨的 markdown
  const lines: string[] = [];

  for (const category of parsed.categories) {
    lines.push(`# ${category.name}`);
    lines.push('');

    for (const article of category.articles) {
      lines.push(`## ${article.title}`);
      lines.push('');
      lines.push(article.content);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}
