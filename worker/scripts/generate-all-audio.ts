/**
 * 一次性腳本：為所有 digital 文稿生成語音和字幕
 * 會跳過 bucket 中已存在 mp3 的文稿
 *
 * 用法：npx tsx scripts/generate-all-audio.ts
 */

import { createClient } from '@supabase/supabase-js';
import { initSupabase } from '../src/services/supabase.js';
import { generateArticleAudio } from '../src/services/tts.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:8000';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

if (!SUPABASE_KEY) {
  console.error('❌ 請設定 SUPABASE_SERVICE_KEY 環境變數');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 初始化 worker 的 supabase（uploadToStorage 需要）
initSupabase();

async function main() {
  // 1. 取得所有 digital 文稿
  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, weekly_id, title, content')
    .eq('platform', 'digital')
    .order('weekly_id', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    console.error('❌ 查詢文稿失敗:', error.message);
    process.exit(1);
  }

  console.log(`共 ${articles.length} 篇 digital 文稿\n`);

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const mp3Path = `articles/${article.weekly_id}/mp3/${article.id}.mp3`;

    // 2. 檢查 bucket 是否已有 mp3
    const { data: existing } = await supabase.storage
      .from('weekly')
      .list(`articles/${article.weekly_id}/mp3`, {
        search: `${article.id}.mp3`,
      });

    if (existing && existing.some(f => f.name === `${article.id}.mp3`)) {
      console.log(`[${i + 1}/${articles.length}] ⏭ 跳過（已存在）: ${article.title}`);
      skipped++;
      continue;
    }

    // 3. 生成語音
    console.log(`[${i + 1}/${articles.length}] 🎙 生成中: ${article.title}`);
    try {
      const result = await generateArticleAudio(
        article.weekly_id,
        article.id,
        article.content,
        (msg) => {
          process.stdout.write(`\r  → ${msg}                    `);
        },
      );
      console.log(`\r  ✅ 完成: ${result.duration.toFixed(0)}s, ${mp3Path}`);
      generated++;
    } catch (err) {
      console.log(`\r  ❌ 失敗: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`\n=============================`);
  console.log(`生成: ${generated}, 跳過: ${skipped}, 失敗: ${failed}`);
  console.log(`總計: ${articles.length}`);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
