import 'dotenv/config';
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk';

async function testThinking() {
  console.log('=== SDK V2 Thinking Test ===\n');

  const session = unstable_v2_createSession({
    model: 'claude-sonnet-4-20250514',
  });

  try {
    const question = `腦筋急轉彎：一個人走進森林最多只能走多遠？請解釋你的思考過程。`;

    console.log(`User: ${question}\n`);
    console.log('--- Messages stream ---\n');

    await session.send(question);

    let msgCount = 0;
    for await (const msg of session.stream()) {
      msgCount++;
      console.log(`[${msgCount}] type: ${msg.type}`);

      if (msg.type === 'assistant') {
        console.log('    role:', msg.message.role);
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            console.log('    text:', block.text.slice(0, 100) + (block.text.length > 100 ? '...' : ''));
          } else if (block.type === 'thinking') {
            console.log('    [THINKING]:', (block as any).thinking?.slice(0, 100) + '...');
          } else {
            console.log(`    block.type: ${block.type}`);
          }
        }
      } else if (msg.type === 'system') {
        console.log('    system message received');
      } else if (msg.type === 'result') {
        console.log('    result:', String((msg as any).result || '').slice(0, 50) + '...');
      } else {
        // 顯示其他類型
        const str = JSON.stringify(msg);
        console.log('    data:', str.slice(0, 150) + (str.length > 150 ? '...' : ''));
      }
      console.log('');
    }

    console.log(`--- Total messages: ${msgCount} ---`);
  } finally {
    session.close();
  }
}

testThinking().catch(console.error);
