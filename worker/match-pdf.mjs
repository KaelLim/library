/**
 * 比對 Synology 檔案清單與 books 資料表，更新 pdf_path
 *
 * Usage: node match-pdf.mjs [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const DRY_RUN = process.argv.includes('--dry-run');
const FILES_URL = 'https://librarypublic.tcstorege.synology.me/files/';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:8000';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_KEY) {
  console.error('Missing SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * 從 Synology 目錄列表抓取所有 PDF 檔名
 */
async function fetchFileList() {
  const res = await fetch(FILES_URL);
  const data = await res.json();

  // JSON 格式: [{ name: "xxx.pdf", size: "123 bytes" }, ...]
  return data
    .map(item => item.name)
    .filter(name => name.endsWith('.pdf'));
}

/**
 * 根據書名嘗試匹配 PDF 檔名
 */
function findMatch(bookTitle, files, categorySlug) {
  // 完全匹配 (title.pdf)
  const exact = files.find(f => f === `${bookTitle}.pdf`);
  if (exact) return exact;

  // 分類特殊處理
  if (categorySlug === 'weekly') {
    // 慈濟週報第75期 → 慈濟週報第75期.pdf
    const m = bookTitle.match(/第(\d+)期/);
    if (m) {
      const num = m[1];
      const found = files.find(f => f.includes(`週報`) && f.includes(num));
      if (found) return found;
    }
  }

  if (categorySlug === 'monthly') {
    // 慈濟月刊第692期 → 慈濟月刊692期.pdf or similar
    const m = bookTitle.match(/(\d+)/);
    if (m) {
      const num = m[1];
      const found = files.find(f => f.includes('月刊') && f.includes(num));
      if (found) return found;
    }
  }

  if (categorySlug === 'daolu') {
    const m = bookTitle.match(/(\d+)/);
    if (m) {
      const num = m[1];
      const found = files.find(f => f.includes('道侶') && f.includes(num));
      if (found) return found;
    }
  }

  if (categorySlug === 'yearbook') {
    const m = bookTitle.match(/([\d]+年)/);
    if (m) {
      const year = m[1];
      const found = files.find(f => f.includes('年鑑') && f.includes(year));
      if (found) return found;
    }
  }

  if (categorySlug === 'footprint') {
    // 宗門足跡
    const found = files.find(f => {
      const fNorm = f.replace(/\.pdf$/i, '');
      return fNorm === bookTitle || bookTitle.includes(fNorm) || fNorm.includes(bookTitle);
    });
    if (found) return found;
  }

  // 通用：書名包含在檔名中
  const contains = files.find(f => {
    const fName = f.replace(/\.pdf$/i, '');
    return fName === bookTitle || fName.includes(bookTitle) || bookTitle.includes(fName);
  });
  if (contains) return contains;

  // 正規化空白後再比對（處理 NBSP 等特殊空白）
  const norm = s => s.replace(/[\s\u00A0]+/g, ' ').trim();
  const normTitle = norm(bookTitle);
  const normMatch = files.find(f => {
    const fName = norm(f.replace(/\.pdf$/i, ''));
    return fName === normTitle || fName.includes(normTitle) || normTitle.includes(fName);
  });
  if (normMatch) return normMatch;

  return null;
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('---');

  // 1. 抓取檔案清單
  console.log('抓取 Synology 檔案清單...');
  const files = await fetchFileList();
  console.log(`共 ${files.length} 個 PDF 檔案`);

  // 2. 讀取所有書籍
  const { data: books, error } = await supabase
    .from('books')
    .select('id, title, pdf_path, category:books_category(slug)')
    .is('pdf_path', null)
    .order('id');

  if (error) {
    console.error('讀取書籍失敗:', error.message);
    process.exit(1);
  }

  console.log(`需比對 ${books.length} 本書（pdf_path 為 null）`);
  console.log('---');

  let matched = 0;
  let unmatched = 0;
  const unmatchedList = [];

  for (const book of books) {
    const slug = book.category?.slug || '';
    const pdfName = findMatch(book.title, files, slug);

    if (pdfName) {
      matched++;
      const pdfUrl = `${FILES_URL}${encodeURIComponent(pdfName)}`;

      if (!DRY_RUN) {
        const { error: updateError } = await supabase
          .from('books')
          .update({ pdf_path: pdfUrl })
          .eq('id', book.id);

        if (updateError) {
          console.error(`更新 #${book.id} 失敗:`, updateError.message);
        }
      }

      if (matched <= 10 || DRY_RUN) {
        console.log(`✅ #${book.id} "${book.title}" → ${pdfName}`);
      }
    } else {
      unmatched++;
      unmatchedList.push({ id: book.id, title: book.title, slug });
    }
  }

  console.log('---');
  console.log(`比對結果: ${matched} 匹配, ${unmatched} 未匹配`);

  if (unmatchedList.length > 0 && unmatchedList.length <= 50) {
    console.log('\n未匹配清單:');
    unmatchedList.forEach(b => console.log(`  #${b.id} [${b.slug}] ${b.title}`));
  } else if (unmatchedList.length > 50) {
    console.log(`\n未匹配前 30 筆:`);
    unmatchedList.slice(0, 30).forEach(b => console.log(`  #${b.id} [${b.slug}] ${b.title}`));
    console.log(`  ... 還有 ${unmatchedList.length - 30} 筆`);
  }
}

main().catch(console.error);
