import 'dotenv/config';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { initSupabase, getSupabase } from './src/services/supabase.js';

// Initialize Supabase
initSupabase();
const supabase = getSupabase();

const weeklyId = 999;

async function main() {
  console.log('=== Query Streaming Test with includePartialMessages ===\n');

  // Subscribe to channel
  const channelName = `import:${weeklyId}`;
  console.log(`[Test] Channel: ${channelName}`);

  const channel = supabase.channel(channelName);

  await new Promise<void>((resolve, reject) => {
    channel
      .on('broadcast', { event: 'session_output' }, (payload) => {
        const data = payload.payload?.data;
        console.log(`\n[Broadcast] type=${data?.type}, content=${data?.message?.content?.slice(0, 50)}...`);
      })
      .subscribe((status) => {
        console.log(`[Channel] ${status}`);
        if (status === 'SUBSCRIBED') resolve();
        if (status === 'CHANNEL_ERROR') reject(new Error('Channel error'));
      });
  });

  // Broadcast helper
  const broadcast = async (type: string, content: string) => {
    await channel.send({
      type: 'broadcast',
      event: 'session_output',
      payload: { data: { type, message: { content } }, timestamp: new Date().toISOString() },
    });
  };

  // Create async generator for prompt
  async function* generateMessages() {
    yield {
      type: 'user' as const,
      message: {
        role: 'user' as const,
        content: `請用繁體中文詳細解釋以下主題，每個主題至少寫 3 段：

1. 什麼是人工智慧？它如何影響我們的日常生活？
2. 機器學習和深度學習有什麼區別？
3. 未來 AI 發展的趨勢和挑戰是什麼？

請確保回答詳盡且有條理。`,
      },
    };
  }

  console.log('\n[Query] Starting with includePartialMessages: true...');
  await broadcast('system', 'Query started');

  try {
    let messageCount = 0;
    let streamEventCount = 0;
    let accumulatedText = '';

    for await (const msg of query({
      prompt: generateMessages(),
      options: {
        model: 'claude-sonnet-4-20250514',
        maxTurns: 1,
        includePartialMessages: true,  // 關鍵！啟用 token-level streaming
      },
    })) {
      messageCount++;

      // 處理 stream_event (partial messages - token level)
      if (msg.type === 'stream_event') {
        streamEventCount++;
        const event = (msg as any).event;

        // content_block_delta 包含實際的 text delta
        if (event?.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta?.type === 'text_delta' && delta?.text) {
            accumulatedText += delta.text;
            // 每 100 字元廣播一次
            if (accumulatedText.length >= 100) {
              console.log(`[Stream] Chunk: "${accumulatedText.slice(0, 50)}..."`);
              await broadcast('assistant', accumulatedText);
              accumulatedText = '';
            }
          }
        }

        // 顯示其他 event 類型
        if (streamEventCount <= 5 || streamEventCount % 50 === 0) {
          console.log(`[Stream #${streamEventCount}] event.type: ${event?.type}`);
        }
      }

      // 處理完整 assistant 訊息
      if (msg.type === 'assistant') {
        console.log(`\n[Assistant] Complete message received`);
      }

      // 處理 system 訊息
      if (msg.type === 'system') {
        console.log(`[System] subtype: ${(msg as any).subtype}`);
      }

      // 處理結果
      if (msg.type === 'result') {
        // 廣播剩餘的文字
        if (accumulatedText) {
          await broadcast('assistant', accumulatedText);
        }

        const result = msg as any;
        console.log(`\n[Result] subtype: ${result.subtype}`);
        console.log(`[Result] Total stream events: ${streamEventCount}`);
        console.log(`[Result] Result preview: ${result.result?.slice(0, 100)}...`);
      }
    }

    console.log(`\n[Query] Total messages: ${messageCount}`);
    console.log(`[Query] Stream events: ${streamEventCount}`);
  } catch (err) {
    console.error('[Error]', err);
  } finally {
    await broadcast('system', 'Query completed');
    await supabase.removeChannel(channel);
    console.log('\n[Done]');
    process.exit(0);
  }
}

main();
