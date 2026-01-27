import 'dotenv/config';
import {
  unstable_v2_createSession,
  unstable_v2_prompt,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';

// Helper: 從 assistant message 提取文字
function getAssistantText(msg: SDKMessage): string | null {
  if (msg.type !== 'assistant') return null;
  return msg.message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

async function testOneShot() {
  console.log('=== Test 1: One-shot prompt ===\n');

  const result = await unstable_v2_prompt('What is 2 + 2?', {
    model: 'claude-sonnet-4-20250514',
  });

  console.log('Result:', result.result);
  console.log();
}

async function testSession() {
  console.log('=== Test 2: Session (multi-turn) ===\n');

  const session = unstable_v2_createSession({
    model: 'claude-sonnet-4-20250514',
  });

  try {
    // Turn 1
    console.log('User: What is 5 + 3?');
    await session.send('What is 5 + 3?');

    for await (const msg of session.stream()) {
      const text = getAssistantText(msg);
      if (text) {
        console.log('Assistant:', text);
      }
    }

    // Turn 2
    console.log('\nUser: Multiply that by 2');
    await session.send('Multiply that by 2');

    for await (const msg of session.stream()) {
      const text = getAssistantText(msg);
      if (text) {
        console.log('Assistant:', text);
      }
    }
  } finally {
    session.close();
  }

  console.log();
}

async function testSessionStream() {
  console.log('=== Test 3: Session with streaming messages ===\n');

  const session = unstable_v2_createSession({
    model: 'claude-sonnet-4-20250514',
  });

  try {
    console.log('User: 請用繁體中文簡短介紹慈濟基金會');
    await session.send('請用繁體中文簡短介紹慈濟基金會');

    let sessionId: string | undefined;

    for await (const msg of session.stream()) {
      sessionId = msg.session_id;

      // 顯示所有 message types
      if (msg.type === 'assistant') {
        const text = getAssistantText(msg);
        if (text) {
          console.log('Assistant:', text);
        }
      } else {
        console.log(`[${msg.type}]`);
      }
    }

    console.log('\nSession ID:', sessionId);
  } finally {
    session.close();
  }
}

async function main() {
  try {
    await testOneShot();
    await testSession();
    await testSessionStream();

    console.log('=== All tests completed ===');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
