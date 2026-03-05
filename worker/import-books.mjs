/**
 * 方案 1：從 books.json 導入書籍資料到 Supabase books 資料表
 * - 不處理 PDF（pdf_path 留空）
 * - 欄位映射 + 型別轉換
 *
 * Usage: node import-books.mjs [--dry-run]
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOOKS_JSON_PATH = join(__dirname, '..', 'books.json');

const DRY_RUN = process.argv.includes('--dry-run');

// Supabase setup
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:8000';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_KEY) {
  console.error('Missing SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Copyright mapping
const COPYRIGHT_MAP = {
  tzuchi_copyright: '慈濟基金會所有',
  other_copyright: '移轉授權使用',
};

/**
 * 將 books.json 的一筆資料轉換為 DB 格式
 */
function mapBookRecord(item) {
  return {
    // 基本資訊
    category_id: parseInt(item.books_catid, 10) || null,
    book_url: item.bookUrl || null,
    title: item.title,
    introtext: item.introtext || null,
    catalogue: item.catalogue || null,

    // 作者/出版
    author: item.author || null,
    author_introtext: item.author_introtext || null,
    publisher: item.publisher || null,
    book_date: item.book_date || null,
    isbn: item.isbn || null,

    // 設定
    language: item.language || 'zh-TW',
    turn_page: item.turn_page || 'left',
    copyright: COPYRIGHT_MAP[item.copyright] || null,
    download: item.download === 'yes',
    online_purchase: item.online_purchase === '無' ? null : (item.online_purchase || null),

    // 日期
    publish_date: item.publish || null,

    // 統計
    hits: parseInt(item.hits, 10) || 0,

    // pdf_path 留空，方案 1 不處理 PDF
    pdf_path: null,
  };
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (不寫入)' : 'LIVE (寫入資料庫)'}`);
  console.log('---');

  // 讀取 books.json
  const data = JSON.parse(readFileSync(BOOKS_JSON_PATH, 'utf-8'));
  const tableData = data.find(r => r.type === 'table' && r.name === 'books');

  if (!tableData) {
    console.error('books.json 中找不到 books table 資料');
    process.exit(1);
  }

  const items = tableData.data;
  console.log(`共 ${items.length} 筆書籍資料`);

  // 檢查現有資料
  const { count: existingCount } = await supabase
    .from('books')
    .select('id', { count: 'exact', head: true });

  console.log(`資料庫現有 ${existingCount || 0} 筆書籍`);

  if (existingCount > 0) {
    console.error('資料庫已有書籍資料，請先清空或確認是否要繼續');
    console.error('如果要清空: DELETE FROM books;');
    process.exit(1);
  }

  // 轉換資料
  const records = items.map(mapBookRecord);

  if (DRY_RUN) {
    console.log('---');
    console.log('前 3 筆轉換結果:');
    records.slice(0, 3).forEach((r, i) => {
      console.log(`\n[${i + 1}] ${r.title}`);
      console.log(JSON.stringify(r, null, 2));
    });

    // 統計
    const stats = {
      total: records.length,
      withBookUrl: records.filter(r => r.book_url).length,
      copyrightTzuchi: records.filter(r => r.copyright === '慈濟基金會所有').length,
      copyrightOther: records.filter(r => r.copyright === '移轉授權使用').length,
      downloadYes: records.filter(r => r.download).length,
    };
    console.log('\n--- 統計 ---');
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  // 批次寫入（每次 100 筆）
  const BATCH_SIZE = 100;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from('books')
      .insert(batch);

    if (error) {
      console.error(`Batch ${i}-${i + batch.length} 失敗:`, error.message);
      errors += batch.length;
    } else {
      inserted += batch.length;
      console.log(`已匯入 ${inserted}/${records.length}`);
    }
  }

  console.log('---');
  console.log(`完成: 匯入 ${inserted} 筆, 失敗 ${errors} 筆`);

  // 重設 sequence
  const { error: seqError } = await supabase.rpc('reset_books_sequence');
  if (seqError) {
    console.log('注意: 無法自動重設 sequence，請手動執行:');
    console.log("SELECT setval('books_id_seq', (SELECT MAX(id) FROM books));");
  }
}

main().catch(console.error);
