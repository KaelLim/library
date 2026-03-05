import { loadMarkdownFromFile, extractWeeklyId, downloadMarkdownFromGoogleDocs } from './services/google-docs.js';
import { processAllImages } from './services/image-processor.js';
import { matchAndReplaceImages } from './services/image-matcher.js';
import { extractFolderId } from './services/google-drive.js';
import { parseWeeklyMarkdown, generateCleanMarkdown } from './services/ai-parser.js';
import { rewriteForDigital, generateDescription } from './services/ai-rewriter.js';
import { cleanupChannel } from './services/session-streamer.js';
import {
  initSupabase,
  getOrCreateWeekly,
  insertArticle,
  uploadMarkdown,
  writeAuditLog,
  updateImportProgress,
  broadcastImportProgress,
  clearImportProgress,
} from './services/supabase.js';
import type { ImportStep, ParsedWeekly } from './types/index.js';
import { basename } from 'path';

interface WorkerOptions {
  filePath?: string;
  docId?: string;
  weeklyId?: number;
  userEmail?: string;
  driveFolderUrl?: string;
  providerToken?: string;
}

type ProgressCallback = (step: ImportStep, progress?: string, error?: string) => void;

export async function runImportWorker(
  options: WorkerOptions,
  onProgress?: ProgressCallback
): Promise<void> {
  const { filePath, docId, userEmail } = options;
  let weeklyId: number | undefined;

  // 進度更新函式：console + callback + DB + broadcast
  const updateProgress = async (step: ImportStep, progress?: string, error?: string) => {
    console.log(`[${step}]`, progress || '', error ? `Error: ${error}` : '');
    onProgress?.(step, progress, error);

    // 如果有 weeklyId，更新 DB 和廣播
    if (weeklyId) {
      const progressData = { step, progress, error };
      await updateImportProgress(weeklyId, progressData);
      await broadcastImportProgress(weeklyId, progressData);
    }
  };

  try {
    await updateProgress('starting', '初始化中...');

    // 初始化 Supabase
    initSupabase();

    // 1. 讀取 markdown（從本地檔案或 Google Docs）
    await updateProgress('exporting_docs', docId ? '從 Google Docs 下載中...' : '讀取檔案中...');
    let rawMarkdown: string;
    let source: string;

    if (docId) {
      rawMarkdown = await downloadMarkdownFromGoogleDocs(docId);
      source = `google-docs:${docId}`;
    } else if (filePath) {
      rawMarkdown = await loadMarkdownFromFile(filePath);
      source = filePath;
    } else {
      throw new Error('必須提供 filePath 或 docId');
    }

    // 提取 weekly_id
    const extractedId = extractWeeklyId(filePath ? basename(filePath) : 'document', rawMarkdown);
    weeklyId = options.weeklyId || extractedId || undefined;
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
      metadata: { weekly_id: weeklyId, source, step: 'started' },
    });

    // 2. 處理 base64 圖片
    await updateProgress('converting_images', '轉換圖片中...');
    const markdownWithUrls = await processAllImages(rawMarkdown, weeklyId);

    // 2.5 替換高解析度圖片（如果提供了 Drive 資料夾）
    if (options.driveFolderUrl && options.providerToken) {
      const driveFolderId = extractFolderId(options.driveFolderUrl);
      if (driveFolderId) {
        await updateProgress('replacing_images', '準備替換高解析度圖片...');
        try {
          const replaced = await matchAndReplaceImages({
            weeklyId,
            markdown: markdownWithUrls,
            providerToken: options.providerToken,
            driveFolderId,
            onProgress: async (msg) => {
              await updateProgress('replacing_images', msg);
            },
          });
          console.log(`[replacing_images] Replaced ${replaced} images with high-res versions`);
        } catch (error) {
          // 圖片替換失敗不應阻止整個匯入流程
          console.error('[replacing_images] Error:', error);
          await updateProgress('replacing_images', '圖片替換失敗，繼續匯入...', undefined);
        }
      }
    }

    // 3. 上傳 original.md
    await updateProgress('uploading_original', '上傳原始檔案...');
    await uploadMarkdown(weeklyId, 'original.md', markdownWithUrls);

    // 4. AI 解析
    await updateProgress('ai_parsing', 'AI 解析中...');
    const parsed: ParsedWeekly = await parseWeeklyMarkdown(markdownWithUrls, weeklyId);

    // 5. 生成並上傳 clean.md
    await updateProgress('uploading_clean', '上傳整理後檔案...');
    const cleanMarkdown = await generateCleanMarkdown(markdownWithUrls, parsed);
    await uploadMarkdown(weeklyId, 'clean.md', cleanMarkdown);

    // 6. 匯入 docs 版文稿（含 AI 生成 description）
    const totalArticles = parsed.categories.reduce((sum, cat) => sum + cat.articles.length, 0);
    let importedCount = 0;

    await updateProgress('importing_docs', `匯入原稿中... 0/${totalArticles}`);

    for (const category of parsed.categories) {
      for (const article of category.articles) {
        // 生成 description
        const description = await generateDescription(article.title, article.content, category.name);

        const inserted = await insertArticle({
          weekly_id: weeklyId,
          category_id: category.category_id,
          platform: 'docs',
          title: article.title,
          description,
          content: article.content,
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
        await updateProgress('importing_docs', `匯入原稿中... ${importedCount}/${totalArticles}`);
      }
    }

    // 7. AI 改寫為 digital 版
    let rewrittenCount = 0;
    await updateProgress('ai_rewriting', `AI 改寫中... 0/${totalArticles}`);

    for (const category of parsed.categories) {
      for (const article of category.articles) {
        const rewritten = await rewriteForDigital(article.title, article.content, weeklyId, category.name);

        const inserted = await insertArticle({
          weekly_id: weeklyId,
          category_id: category.category_id,
          platform: 'digital',
          title: rewritten.title,
          description: rewritten.description,
          content: rewritten.content,
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
        await updateProgress('ai_rewriting', `AI 改寫中... ${rewrittenCount}/${totalArticles}`);
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

    await updateProgress('completed', `完成！共匯入 ${totalArticles} 篇文稿`);

    // 清理 streaming channel
    if (weeklyId) await cleanupChannel(weeklyId);

    // 清除進度（延遲幾秒讓前端有時間顯示完成狀態）
    setTimeout(() => {
      if (weeklyId) clearImportProgress(weeklyId);
    }, 5000);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await updateProgress('failed', undefined, errorMessage);

    await writeAuditLog({
      user_email: userEmail || null,
      action: 'import',
      table_name: null,
      record_id: null,
      old_data: null,
      new_data: null,
      metadata: { step: 'failed', error: errorMessage },
    });

    // 清理 streaming channel
    if (weeklyId) await cleanupChannel(weeklyId);

    throw error;
  }
}
