/**
 * 批次生成所有文章的 description
 * 使用方式: npx tsx scripts/batch-descriptions.ts
 */

const WORKER_URL = 'http://localhost:3001';
const BATCH_SIZE = 5; // 每批處理數量
const DELAY_MS = 2000; // 每批之間的延遲（毫秒）

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getRemaining(): Promise<number> {
  const res = await fetch(`${WORKER_URL}/articles-without-description`);
  const data = await res.json();
  return data.count;
}

async function processBatch(): Promise<boolean> {
  const res = await fetch(`${WORKER_URL}/batch-generate-descriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: BATCH_SIZE }),
  });

  const data = await res.json();

  if (data.processed === 0 || data.message === 'No articles need description') {
    return false; // 沒有更多文章需要處理
  }

  return true;
}

async function main() {
  console.log('開始批次生成 description...\n');

  let remaining = await getRemaining();
  console.log(`共 ${remaining} 篇文章需要生成 description\n`);

  if (remaining === 0) {
    console.log('所有文章都已有 description！');
    return;
  }

  let processed = 0;

  while (remaining > 0) {
    console.log(`處理中... 剩餘 ${remaining} 篇`);

    const hasMore = await processBatch();

    if (!hasMore) {
      break;
    }

    processed += BATCH_SIZE;

    // 等待背景處理完成
    await sleep(DELAY_MS);

    // 重新檢查剩餘數量
    remaining = await getRemaining();
  }

  console.log('\n========== 完成 ==========');
  console.log(`已處理約 ${processed} 篇文章`);

  const finalRemaining = await getRemaining();
  console.log(`剩餘 ${finalRemaining} 篇`);
}

main().catch(console.error);
