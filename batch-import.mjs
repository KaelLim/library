#!/usr/bin/env node

/**
 * 批次匯入週報腳本
 * 讀取 list.json，逐一呼叫 Worker /import API
 *
 * 用法：
 *   node batch-import.mjs                    # 匯入全部
 *   node batch-import.mjs --from 90          # 從第 90 期開始
 *   node batch-import.mjs --from 90 --to 95  # 匯入 90-95 期
 *   node batch-import.mjs --only 100         # 只匯入第 100 期
 */

import { readFileSync } from 'fs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const SERVICE_KEY = process.env.SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLAogICAgImlzcyI6ICJzdXBhYmFzZS1kZW1vIiwKICAgICJpYXQiOiAxNjQxNzY5MjAwLAogICAgImV4cCI6IDE3OTk1MzU2MDAKfQ.DaYlNEoUrrEn2Ig7tqibS-PHK5vgusbcbo7X36XVt4Q';
const USER_EMAIL = process.env.USER_EMAIL || 'batch-import@system';
const POLL_INTERVAL = 5000; // 5 秒輪詢一次

// 解析命令列參數
const args = process.argv.slice(2);
let fromWeekly = 0, toWeekly = Infinity, onlyWeekly = 0;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from') fromWeekly = parseInt(args[++i]);
  if (args[i] === '--to') toWeekly = parseInt(args[++i]);
  if (args[i] === '--only') onlyWeekly = parseInt(args[++i]);
}

// 讀取 list.json
const list = JSON.parse(readFileSync('list.json', 'utf-8'));

// 篩選範圍
const filtered = list.filter(item => {
  if (onlyWeekly) return item.weekly === onlyWeekly;
  return item.weekly >= fromWeekly && item.weekly <= toWeekly;
});

console.log(`\n📋 共 ${filtered.length} 期待匯入（${filtered[0]?.weekly} ~ ${filtered[filtered.length - 1]?.weekly}）\n`);

// 輪詢匯入進度
async function waitForCompletion(weeklyId) {
  const start = Date.now();

  while (true) {
    await sleep(POLL_INTERVAL);

    try {
      const resp = await fetch(
        `${BASE_URL}/rest/v1/weekly?week_number=eq.${weeklyId}&select=import_step,import_progress,import_error`,
        {
          headers: {
            'apikey': SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
          },
        }
      );

      if (!resp.ok) continue;
      const [data] = await resp.json();
      if (!data) continue;

      const { import_step, import_progress, import_error } = data;

      if (import_step) {
        process.stdout.write(`\r  [${import_step}] ${import_progress || ''}`.padEnd(80));
      }

      if (import_step === 'completed') {
        process.stdout.write('\n');
        return { success: true, message: import_progress };
      }

      if (import_step === 'failed') {
        process.stdout.write('\n');
        return { success: false, message: import_error };
      }
    } catch {
      // 網路錯誤，繼續等
    }
  }

  // unreachable
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 主流程
let success = 0, failed = 0;

for (const item of filtered) {
  console.log(`▶ 第 ${item.weekly} 期 — ${item.url.substring(0, 60)}...`);

  try {
    // 呼叫 import API
    const resp = await fetch(`${BASE_URL}/worker/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doc_url: item.url,
        weekly_id: item.weekly,
        user_email: USER_EMAIL,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.log(`  ❌ 啟動失敗: ${err.message || resp.status}`);
      failed++;
      continue;
    }

    // 等待完成
    const result = await waitForCompletion(item.weekly);

    if (result.success) {
      console.log(`  ✅ ${result.message}`);
      success++;
    } else {
      console.log(`  ❌ ${result.message}`);
      failed++;
    }
  } catch (error) {
    console.log(`  ❌ 錯誤: ${error.message}`);
    failed++;
  }

  // 間隔 2 秒避免過度負載
  await sleep(2000);
}

console.log(`\n📊 結果: ✅ ${success} 成功 / ❌ ${failed} 失敗 / 共 ${filtered.length} 期\n`);
