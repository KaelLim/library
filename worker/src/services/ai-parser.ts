import type { ParsedWeekly } from '../types/index.js';
import { runSessionWithStreaming } from './session-streamer.js';
import { loadSkillSystemPrompt } from './skill-loader.js';

export async function parseWeeklyMarkdown(
  markdown: string,
  weeklyId: number
): Promise<ParsedWeekly> {
  const systemPrompt = await loadSkillSystemPrompt('parse-weekly');

  const userPrompt = `CRITICAL OUTPUT CONTRACT (read this first, follow it exactly):
- Your entire response MUST be a single valid JSON object.
- The first character MUST be \`{\`. The last character MUST be \`}\`.
- DO NOT write prose, commentary, headings, markdown, code fences, or any text outside the JSON.
- DO NOT prefix with "Here is the JSON" or any explanation. Output the JSON directly.
- All newlines inside string values MUST be escaped as \\n. All double quotes inside string values MUST be escaped as \\".

請解析以下週報 markdown 檔案（weekly_id: ${weeklyId}），輸出結構化 JSON。

再次提醒：只輸出 JSON 物件本身，第一個字元必須是 \`{\`，最後一個字元必須是 \`}\`，中間不可有任何 prose、code fence 或說明文字。

---

${markdown}`;

  const resultText = await runSessionWithStreaming(userPrompt, {
    weeklyId,
    model: 'opus',
    systemPrompt,
    logTag: 'parse-weekly',
  });

  if (!resultText) {
    throw new Error('No result from AI');
  }

  // 提取 JSON：先試 code fence，再 fallback 到 greedy {...}，最後才直接 parse
  const jsonStr = extractJsonObject(resultText);

  try {
    const parsed = JSON.parse(jsonStr) as ParsedWeekly;
    if (!parsed.categories || !Array.isArray(parsed.categories)) {
      throw new Error('AI response missing required field: categories');
    }
    for (const cat of parsed.categories) {
      if (!cat.articles || !Array.isArray(cat.articles)) {
        throw new Error(`Category "${cat.name}" missing required field: articles`);
      }
    }
    parsed.weekly_id = weeklyId; // 確保 weekly_id 正確
    return parsed;
  } catch (e) {
    console.error('[ai-parser] JSON parse failed. AI response preview (first 500 chars):');
    console.error(resultText.substring(0, 500));
    console.error('[ai-parser] AI response tail (last 200 chars):');
    console.error(resultText.substring(Math.max(0, resultText.length - 200)));
    throw new Error(`Failed to parse AI response as JSON: ${e}`);
  }
}

/**
 * 從 AI 回傳文字提取 JSON 物件字串。
 * 順序：1) ```json fence 2) greedy { ... } 3) 整段
 * 給呼叫端的 JSON.parse 仍可能失敗（譬如字串內有未跳脫換行），這裡只負責「拿出最像 JSON 的片段」。
 */
export function extractJsonObject(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    return raw.substring(first, last + 1).trim();
  }

  return raw.trim();
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
