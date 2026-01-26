import Anthropic from '@anthropic-ai/sdk';
import { loadMarkdownFromFile, extractWeeklyId } from './services/google-docs.js';
import { processAllImages } from './services/image-processor.js';
import { parseWeeklyMarkdown, generateCleanMarkdown } from './services/ai-parser.js';
import { rewriteForDigital } from './services/ai-rewriter.js';
import {
  initSupabase,
  getOrCreateWeekly,
  getOrCreateCategory,
  insertArticle,
  uploadMarkdown,
  writeAuditLog,
} from './services/supabase.js';
import type { ImportStep, ParsedWeekly } from './types/index.js';
import { basename } from 'path';

interface WorkerOptions {
  filePath: string;
  weeklyId?: number;
  userEmail?: string;
}

type ProgressCallback = (step: ImportStep, progress?: string, error?: string) => void;

export async function runImportWorker(
  options: WorkerOptions,
  onProgress?: ProgressCallback
): Promise<void> {
  const { filePath, userEmail } = options;

  const log = (step: ImportStep, progress?: string, error?: string) => {
    console.log(`[${step}]`, progress || '', error ? `Error: ${error}` : '');
    onProgress?.(step, progress, error);
  };

  try {
    log('starting');

    // 初始化
    initSupabase();
    const anthropic = new Anthropic();

    // 1. 讀取 markdown 檔案
    log('exporting_docs', '讀取檔案中...');
    const rawMarkdown = await loadMarkdownFromFile(filePath);

    // 提取 weekly_id
    const weeklyId = options.weeklyId || extractWeeklyId(basename(filePath), rawMarkdown);
    if (!weeklyId) {
      throw new Error('無法從檔名或內容提取期數，請手動指定 weeklyId');
    }

    // 確保 weekly 存在
    await getOrCreateWeekly(weeklyId);

    // 記錄 import 開始
    await writeAuditLog({
      user_email: userEmail || null,
      action: 'import',
      table_name: null,
      record_id: null,
      old_data: null,
      new_data: null,
      metadata: { weekly_id: weeklyId, source: filePath, step: 'started' },
    });

    // 2. 處理 base64 圖片
    log('converting_images', '轉換圖片中...');
    const markdownWithUrls = await processAllImages(rawMarkdown, weeklyId);

    // 3. 上傳 original.md
    log('uploading_original', '上傳原始檔案...');
    await uploadMarkdown(weeklyId, 'original.md', markdownWithUrls);

    // 4. AI 解析
    log('ai_parsing', 'AI 解析中...');
    const parsed: ParsedWeekly = await parseWeeklyMarkdown(markdownWithUrls, weeklyId);

    // 5. 生成並上傳 clean.md
    log('uploading_clean', '上傳整理後檔案...');
    const cleanMarkdown = await generateCleanMarkdown(markdownWithUrls, parsed);
    await uploadMarkdown(weeklyId, 'clean.md', cleanMarkdown);

    // 6. 匯入 docs 版文稿
    log('importing_docs', '匯入原稿中...');
    const totalArticles = parsed.categories.reduce((sum, cat) => sum + cat.articles.length, 0);
    let importedCount = 0;

    for (const category of parsed.categories) {
      const dbCategory = await getOrCreateCategory(category.name, category.sort_order);

      for (const article of category.articles) {
        const inserted = await insertArticle({
          weekly_id: weeklyId,
          category_id: dbCategory.id,
          platform: 'docs',
          title: article.title,
          content: article.content,
          order_number: article.order_number,
        });

        await writeAuditLog({
          user_email: userEmail || null,
          action: 'insert',
          table_name: 'articles',
          record_id: inserted.id,
          old_data: null,
          new_data: inserted as unknown as Record<string, unknown>,
          metadata: { weekly_id: weeklyId, platform: 'docs' },
        });

        importedCount++;
        log('importing_docs', `${importedCount}/${totalArticles}`);
      }
    }

    // 7. AI 改寫為 digital 版
    log('ai_rewriting', 'AI 改寫中...');
    let rewrittenCount = 0;

    for (const category of parsed.categories) {
      const dbCategory = await getOrCreateCategory(category.name, category.sort_order);

      for (const article of category.articles) {
        const rewritten = await rewriteForDigital(anthropic, article.title, article.content);

        const inserted = await insertArticle({
          weekly_id: weeklyId,
          category_id: dbCategory.id,
          platform: 'digital',
          title: rewritten.title,
          content: rewritten.content,
          order_number: article.order_number,
        });

        await writeAuditLog({
          user_email: userEmail || null,
          action: 'ai_transform',
          table_name: 'articles',
          record_id: inserted.id,
          old_data: null,
          new_data: inserted as unknown as Record<string, unknown>,
          metadata: {
            weekly_id: weeklyId,
            platform: 'digital',
            model: 'claude-sonnet-4-20250514',
            source_title: article.title,
          },
        });

        rewrittenCount++;
        log('ai_rewriting', `${rewrittenCount}/${totalArticles}`);
      }
    }

    // 完成
    await writeAuditLog({
      user_email: userEmail || null,
      action: 'import',
      table_name: null,
      record_id: null,
      old_data: null,
      new_data: null,
      metadata: { weekly_id: weeklyId, step: 'completed', total_articles: totalArticles },
    });

    log('completed', `完成！共匯入 ${totalArticles} 篇文稿`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log('failed', undefined, errorMessage);

    await writeAuditLog({
      user_email: userEmail || null,
      action: 'import',
      table_name: null,
      record_id: null,
      old_data: null,
      new_data: null,
      metadata: { step: 'failed', error: errorMessage },
    });

    throw error;
  }
}
