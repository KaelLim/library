import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFile } from 'fs/promises';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadSkill(skillName: string): Promise<string> {
  const skillPath = join(__dirname, '../../.claude/skills', `${skillName}.md`);
  return readFile(skillPath, 'utf-8');
}

async function testAIParsing() {
  // 讀取處理後的 markdown（已去除 base64）
  const markdownPath = '/Users/kaellim/Desktop/projects/library/worker/test-output/processed.md';
  const markdown = await readFile(markdownPath, 'utf-8');

  console.log('讀取 skill...');
  const skill = await loadSkill('parse-weekly-md');

  const prompt = `${skill}

---

請解析以下週報 markdown 檔案（weekly_id: 117），輸出結構化 JSON。

只輸出 JSON，不要有其他文字。

---

${markdown}`;

  console.log('發送請求給 AI...');

  const queryInstance = query({
    prompt,
    options: {
      maxTurns: 1,
      systemPrompt: '你是一個 JSON 解析助手。只輸出有效的 JSON，不要有任何其他文字或 markdown 代碼塊。',
    },
  });

  let result = '';

  for await (const message of queryInstance) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') {
          result += block.text;
        }
      }
    }
  }

  console.log('\n=== AI 回應 ===\n');

  // 嘗試提取 JSON
  let jsonStr = result;
  const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  try {
    const parsed = JSON.parse(jsonStr.trim());
    console.log('解析成功！');
    console.log(`分類數量: ${parsed.categories?.length || 0}`);

    if (parsed.categories) {
      for (const cat of parsed.categories) {
        console.log(`  - ${cat.name}: ${cat.articles?.length || 0} 篇文稿`);
      }
    }

    // 儲存結果
    const outputPath = '/Users/kaellim/Desktop/projects/library/worker/test-output/parsed.json';
    await writeFile(outputPath, JSON.stringify(parsed, null, 2));
    console.log(`\n結果已儲存至: ${outputPath}`);
  } catch (e) {
    console.log('JSON 解析失敗，原始回應:');
    console.log(result.slice(0, 2000));
  }
}

testAIParsing().catch(console.error);
