#!/usr/bin/env node
/**
 * 量測所有電子書 PDF 的每頁寬高比分佈。
 *
 * 目的：決定 PDF reader 的 per-unit 尺寸方案。
 *   - 若混合寬高比的書都是 A 系列（0.7071 / 1.4142），兩張直式併排 = 一張橫式，
 *     可以在 app.ts 端合成，完全不動 StPageFlip fork（方案 B）。
 *   - 若不是 A 系列，unit 寬度不一致，需要 per-unit 寬度邏輯。
 *
 * 在正式機執行：
 *   docker compose cp scan-book-aspects.mjs worker:/tmp/scan-book-aspects.mjs
 *   docker compose exec worker node /tmp/scan-book-aspects.mjs
 *
 * 唯讀：只下載 PDF 到容器內 /tmp 分析，不寫任何資料庫、不改任何檔案。
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('缺少 SUPABASE_URL / SUPABASE_SERVICE_KEY 環境變數');
  process.exit(1);
}

const A_SERIES = Math.SQRT2;          // 1.41421356…
const A_SERIES_INV = 1 / Math.SQRT2;  // 0.70710678…
const TOLERANCE = 0.01;               // 1% — 涵蓋 PDF 點數四捨五入
const LANDSCAPE_THRESHOLD = 1.3;      // 與 app.ts:365 SPREAD_ASPECT_THRESHOLD 一致

const near = (a, b) => Math.abs(a - b) / b < TOLERANCE;
const isASeries = (aspect) => near(aspect, A_SERIES) || near(aspect, A_SERIES_INV);

async function listBooks() {
  const url = `${SUPABASE_URL}/rest/v1/books?select=book_id,name,pdf_path&order=name`;
  const res = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`列出書籍失敗 ${res.status}: ${await res.text()}`);
  return res.json();
}

async function downloadPdf(pdfPath, destPath) {
  // pdf_path 可能含或不含 bucket 前綴，兩種都試
  const candidates = [pdfPath, pdfPath.replace(/^books\//, '')];
  for (const p of candidates) {
    const url = `${SUPABASE_URL}/storage/v1/object/books/${p}`;
    const res = await fetch(url, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (res.ok) {
      writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
      return true;
    }
  }
  return false;
}

function pageSizes(pdfPath) {
  // pdfinfo -f 1 -l 9999 會逐頁列出 "Page  N size: W x H pts (Label)"
  const out = execFileSync('pdfinfo', ['-f', '1', '-l', '9999', pdfPath], {
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const sizes = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/);
    if (m) sizes.push({ page: +m[1], w: +m[2], h: +m[3] });
  }
  return sizes;
}

function analyse(sizes) {
  const buckets = new Map();
  for (const s of sizes) {
    const key = `${s.w.toFixed(2)}x${s.h.toFixed(2)}`;
    if (!buckets.has(key)) {
      buckets.set(key, { w: s.w, h: s.h, aspect: s.w / s.h, count: 0, pages: [] });
    }
    const b = buckets.get(key);
    b.count++;
    if (b.pages.length < 8) b.pages.push(s.page);
  }

  const distinct = [...buckets.values()].sort((a, b) => b.count - a.count);
  const aspects = distinct.map((d) => d.aspect);
  const hasLandscape = aspects.some((a) => a > LANDSCAPE_THRESHOLD);
  const hasPortrait = aspects.some((a) => a <= LANDSCAPE_THRESHOLD);
  const mixed = hasLandscape && hasPortrait;
  const allASeries = aspects.every(isASeries);

  // 關鍵檢查：兩張直式併排的寬度，是否等於一張橫式的寬度（同高度下）
  // 直式 aspect p、橫式 aspect l，同高 H 時：2*p*H vs l*H  →  比較 2p 與 l
  let pairMatchesLandscape = null;
  if (mixed) {
    const portrait = distinct.find((d) => d.aspect <= LANDSCAPE_THRESHOLD);
    const landscape = distinct.find((d) => d.aspect > LANDSCAPE_THRESHOLD);
    pairMatchesLandscape = near(2 * portrait.aspect, landscape.aspect);
  }

  return { distinct, mixed, allASeries, pairMatchesLandscape, hasLandscape, hasPortrait };
}

const books = await listBooks();
console.log(`共 ${books.length} 本書\n${'='.repeat(78)}`);

const tmp = mkdtempSync(join(tmpdir(), 'aspect-'));
const summary = { total: 0, uniform: 0, mixed: 0, mixedPairMatches: 0, failed: 0 };
const mixedBooks = [];

try {
  for (const book of books) {
    if (!book.pdf_path) {
      console.log(`\n[略過] ${book.name} — 無 pdf_path`);
      continue;
    }
    const dest = join(tmp, 'book.pdf');
    let sizes;
    try {
      if (!(await downloadPdf(book.pdf_path, dest))) {
        console.log(`\n[失敗] ${book.name} — 下載不到 ${book.pdf_path}`);
        summary.failed++;
        continue;
      }
      sizes = pageSizes(dest);
    } catch (err) {
      console.log(`\n[失敗] ${book.name} — ${err.message.split('\n')[0]}`);
      summary.failed++;
      continue;
    } finally {
      rmSync(dest, { force: true });
    }

    if (!sizes.length) {
      console.log(`\n[失敗] ${book.name} — pdfinfo 讀不到頁面尺寸`);
      summary.failed++;
      continue;
    }

    summary.total++;
    const a = analyse(sizes);
    const tag = a.mixed ? '⚠️ 混合' : '✅ 統一';
    console.log(`\n${tag}  ${book.name}  (${sizes.length} 頁)`);

    for (const d of a.distinct) {
      const kind = d.aspect > LANDSCAPE_THRESHOLD ? '橫' : '直';
      const aser = isASeries(d.aspect) ? ' A系列' : '';
      const pages = d.pages.join(',') + (d.count > d.pages.length ? '…' : '');
      console.log(
        `    ${kind} ${d.w.toFixed(1)}x${d.h.toFixed(1)}  aspect=${d.aspect.toFixed(4)}${aser}` +
        `  ${d.count} 頁  [p${pages}]`
      );
    }

    if (a.mixed) {
      summary.mixed++;
      mixedBooks.push(book.name);
      console.log(`    → 全部 A 系列：${a.allASeries ? '是' : '否'}`);
      console.log(
        `    → 兩張直式併排寬度 == 一張橫式：${a.pairMatchesLandscape ? '是 ✅ 方案B可行' : '否 ❌ 需 per-unit 寬度'}`
      );
      if (a.pairMatchesLandscape) summary.mixedPairMatches++;
    } else {
      summary.uniform++;
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${'='.repeat(78)}\n總結`);
console.log(`  成功分析      ${summary.total} 本`);
console.log(`  尺寸統一      ${summary.uniform} 本（現行邏輯本來就沒問題）`);
console.log(`  混合寬高比    ${summary.mixed} 本  ← 這些是出問題的`);
console.log(`  其中可合成    ${summary.mixedPairMatches} 本（兩張直式併排 == 一張橫式）`);
console.log(`  讀取失敗      ${summary.failed} 本`);

if (mixedBooks.length) {
  console.log(`\n混合寬高比的書：`);
  for (const n of mixedBooks) console.log(`  - ${n}`);
}

console.log(`\n判讀：`);
if (summary.mixed === 0) {
  console.log(`  沒有任何混合寬高比的書 — 需要重新確認問題出在哪本書。`);
} else if (summary.mixedPairMatches === summary.mixed) {
  console.log(`  全部混合書都符合「兩張直式 == 一張橫式」→ 方案 B 可行，不必改 StPageFlip fork。`);
} else {
  console.log(
    `  有 ${summary.mixed - summary.mixedPairMatches} 本不符合 → 這些書需要 per-unit 寬度，` +
    `方案 B 要加寬度分支，或改走方案 A。`
  );
}
