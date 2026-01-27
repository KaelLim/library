import 'dotenv/config';
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk';

async function testStreaming() {
  console.log('=== SDK V2 Streaming Test ===\n');

  const session = unstable_v2_createSession({
    model: 'claude-sonnet-4-20250514',
  });

  try {
    console.log('User: 請用繁體中文寫一首關於台灣的短詩\n');
    console.log('--- Streaming output ---');

    await session.send('請用繁體中文寫一首關於台灣的短詩');

    for await (const msg of session.stream()) {
      // 顯示每個 message 的類型和內容
      console.log(`\n[type: ${msg.type}]`);

      if (msg.type === 'assistant') {
        // 檢查 content 結構
        for (const block of msg.message.content) {
          console.log(`  block.type: ${block.type}`);
          if (block.type === 'text') {
            console.log(`  text: "${block.text}"`);
          }
        }
      } else if (msg.type === 'content_block_delta') {
        // Delta streaming
        console.log(`  delta:`, JSON.stringify(msg));
      } else if (msg.type === 'result') {
        console.log(`  result: ${(msg as any).result || '(completed)'}`);
      } else {
        // 其他類型，顯示完整結構
        console.log(`  data:`, JSON.stringify(msg, null, 2).slice(0, 200));
      }
    }

    console.log('\n--- End of stream ---');
  } finally {
    session.close();
  }
}

testStreaming().catch(console.error);
