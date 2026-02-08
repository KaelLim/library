import { query } from '@anthropic-ai/claude-agent-sdk';
import { getSupabase } from './supabase.js';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface SessionStreamOptions {
  weeklyId: number;
  model?: string;
  allowedTools?: string[];
  chunkSize?: number; // 每多少字元廣播一次，預設 100
}

export interface SessionMessage {
  type: 'user' | 'assistant' | 'system';
  message?: {
    content?: string;
  };
  timestamp?: string;
}

// 快取 channel 避免重複建立/銷毀導致的訂閱問題
const channelCache = new Map<number, RealtimeChannel>();

/**
 * 取得或建立指定 weeklyId 的 channel
 */
async function getOrCreateChannel(weeklyId: number): Promise<RealtimeChannel> {
  const existing = channelCache.get(weeklyId);
  if (existing) {
    return existing;
  }

  const channel = getSupabase().channel(`import:${weeklyId}`);

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.log(`[Query] Channel subscribe timeout for weekly ${weeklyId}, proceeding with REST fallback`);
      resolve();
    }, 5000);

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout);
        console.log(`[Query] Channel subscribed for weekly ${weeklyId}`);
        resolve();
      } else if (status === 'CHANNEL_ERROR') {
        clearTimeout(timeout);
        console.log(`[Query] Channel error for weekly ${weeklyId}, proceeding with REST fallback`);
        resolve();
      }
    });
  });

  channelCache.set(weeklyId, channel);
  return channel;
}

/**
 * 清除指定 weeklyId 的 channel（匯入完成後呼叫）
 */
export async function cleanupChannel(weeklyId: number): Promise<void> {
  const channel = channelCache.get(weeklyId);
  if (channel) {
    await getSupabase().removeChannel(channel);
    channelCache.delete(weeklyId);
    console.log(`[Query] Channel cleaned up for weekly ${weeklyId}`);
  }
}

/**
 * 執行 Claude query 並即時串流輸出到 Supabase channel
 * 使用 includePartialMessages: true 取得 token-level streaming
 */
export async function runSessionWithStreaming(
  prompt: string,
  options: SessionStreamOptions
): Promise<string> {
  const {
    weeklyId,
    model = 'claude-sonnet-4-20250514',
    allowedTools = [],
    chunkSize = 100,
  } = options;

  // 取得或建立 channel（使用快取避免重複建立）
  const channel = await getOrCreateChannel(weeklyId);

  // 廣播函數
  const broadcast = async (data: SessionMessage) => {
    try {
      await channel.send({
        type: 'broadcast',
        event: 'session_output',
        payload: {
          data,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('[Query] Broadcast error:', err);
    }
  };

  // 建立 async generator 來發送 prompt
  async function* generateMessages() {
    yield {
      type: 'user' as const,
      message: {
        role: 'user' as const,
        content: prompt,
      },
    };
  }

  let result = '';
  let accumulatedText = '';
  let streamEventCount = 0;

  try {
    console.log('[Query] Starting with prompt length:', prompt.length);

    // 廣播開始
    await broadcast({
      type: 'system',
      message: { content: 'AI 處理開始' },
      timestamp: new Date().toISOString(),
    });

    // 使用 query() 進行串流，啟用 includePartialMessages
    for await (const msg of query({
      prompt: generateMessages() as any,
      options: {
        model,
        allowedTools,
        maxTurns: 1,
        includePartialMessages: true, // 關鍵！啟用 token-level streaming
      },
    })) {
      // 處理 stream_event (partial messages - token level)
      if (msg.type === 'stream_event') {
        streamEventCount++;
        const event = (msg as any).event;

        // content_block_delta 包含實際的 text delta
        if (event?.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta?.type === 'text_delta' && delta?.text) {
            accumulatedText += delta.text;

            // 累積到指定大小就廣播
            if (accumulatedText.length >= chunkSize) {
              await broadcast({
                type: 'assistant',
                message: { content: accumulatedText },
                timestamp: new Date().toISOString(),
              });
              accumulatedText = '';
            }
          }
        }
      }

      // 處理結果
      if (msg.type === 'result') {
        // 廣播剩餘的文字
        if (accumulatedText) {
          await broadcast({
            type: 'assistant',
            message: { content: accumulatedText },
            timestamp: new Date().toISOString(),
          });
        }

        console.log('[Query] Result subtype:', (msg as any).subtype);
        console.log('[Query] Stream events:', streamEventCount);

        if ((msg as any).subtype === 'success') {
          result = (msg as any).result;
          console.log('[Query] Success, result length:', result?.length || 0);
        } else {
          throw new Error(`Query failed: ${JSON.stringify(msg)}`);
        }
      }
    }

    console.log('[Query] Completed');
  } catch (error) {
    console.error('[Query] Error:', error);
    throw error;
  } finally {
    // 廣播結束（不在這裡清理 channel，由 cleanupChannel() 統一處理）
    await broadcast({
      type: 'system',
      message: { content: 'AI 處理完成' },
      timestamp: new Date().toISOString(),
    });
  }

  return result;
}
