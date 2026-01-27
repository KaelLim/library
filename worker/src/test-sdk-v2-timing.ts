import 'dotenv/config';
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk';

async function testTiming() {
  console.log('=== SDK V2 Timing Test ===\n');

  const session = unstable_v2_createSession({
    model: 'claude-sonnet-4-20250514',
  });

  const startTime = Date.now();
  const elapsed = () => `+${((Date.now() - startTime) / 1000).toFixed(2)}s`;

  try {
    const question = `請用繁體中文詳細解釋：
1. 什麼是區塊鏈？
2. 它的三個主要應用場景
3. 未來發展趨勢

每個部分請寫 2-3 段。`;

    console.log(`[${elapsed()}] User: ${question.slice(0, 50)}...\n`);
    console.log('--- Messages stream (with timing) ---\n');

    await session.send(question);
    console.log(`[${elapsed()}] send() completed, starting stream...\n`);

    let msgCount = 0;
    for await (const msg of session.stream()) {
      msgCount++;

      if (msg.type === 'assistant') {
        const textLength = msg.message.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('').length;
        console.log(`[${elapsed()}] [${msgCount}] type: ${msg.type} (${textLength} chars)`);
      } else {
        console.log(`[${elapsed()}] [${msgCount}] type: ${msg.type}`);
      }
    }

    console.log(`\n[${elapsed()}] --- Stream completed, total: ${msgCount} messages ---`);
  } finally {
    session.close();
  }
}

testTiming().catch(console.error);
