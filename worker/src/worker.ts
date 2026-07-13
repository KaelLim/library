import { loadMarkdownFromFile, extractWeeklyId, downloadMarkdownFromGoogleDocs } from './services/google-docs.js';
import { processAllImages } from './services/image-processor.js';
import { replaceWithDriveHighRes } from './services/image-matcher.js';
import { validateDocImagesAgainstDrive, ImageValidationError } from './services/image-code.js';
import { extractFolderId, listImagesRecursive } from './services/google-drive.js';
import { getServiceAccessToken, isServiceAccountConfigured } from './services/google-drive-auth.js';
import { parseWeeklyMarkdown, generateCleanMarkdown } from './services/ai-parser.js';
import { rewriteForDigital, generateDescription } from './services/ai-rewriter.js';
import { normalizeNumbers } from './services/normalize-numbers.js';
import { cleanupChannel } from './services/session-streamer.js';
import { generateArticleAudio } from './services/tts.js';
import {
  initSupabase,
  getOrCreateWeekly,
  setWeeklyDriveFolderUrl,
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

    // 記住 Drive 資料夾，方便日後補圖
    if (options.driveFolderUrl) {
      try {
        await setWeeklyDriveFolderUrl(weeklyId, options.driveFolderUrl);
      } catch (err) {
        console.warn('[Import] Failed to save drive_folder_url to weekly:', err);
      }
    }

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

    // 2. Drive 認證 + 驗證圖片編號
    if (!options.driveFolderUrl) {
      throw new Error('必須提供 driveFolderUrl（x-x-x 圖片對應必要）');
    }
    const driveFolderId = extractFolderId(options.driveFolderUrl);
    if (!driveFolderId) {
      throw new Error(`無效的 Drive 資料夾 URL：${options.driveFolderUrl}`);
    }

    let driveToken: string | null = null;
    let driveTokenSource = '';
    try {
      if (isServiceAccountConfigured()) {
        driveToken = await getServiceAccessToken();
        driveTokenSource = 'service_account';
      }
    } catch (err) {
      console.warn('[validating_images] Service account token failed, fallback to user token:', err);
    }
    if (!driveToken && options.providerToken) {
      driveToken = options.providerToken;
      driveTokenSource = 'user_oauth';
    }
    if (!driveToken) {
      throw new Error('無 Drive 認證，無法列出 x-x-x 檔案');
    }
    console.log(`[validating_images] Using ${driveTokenSource} for Drive auth`);

    await updateProgress('validating_images', '列出 Drive 圖片並驗證編號...');
    const driveFiles = await listImagesRecursive(driveToken, driveFolderId);

    let validation;
    try {
      validation = validateDocImagesAgainstDrive(rawMarkdown, driveFiles);
    } catch (err) {
      if (err instanceof ImageValidationError) {
        await writeAuditLog({
          user_email: userEmail || null,
          action: 'import',
          table_name: null,
          record_id: null,
          old_data: null,
          new_data: null,
          metadata: {
            weekly_id: weeklyId,
            step: 'validation_failed',
            ...err.details,
          },
        });
        await updateProgress('failed', undefined, err.message);
        return;
      }
      throw err;
    }
    const { xxxCodes, xxxToDriveFile } = validation;
    console.log(`[validating_images] OK — ${xxxCodes.length} 張圖片對應完成`);

    // 3. 處理 base64 圖片（以 x-x-x 命名）
    await updateProgress('converting_images', `轉換 ${xxxCodes.length} 張圖片...`);
    const markdownWithUrls = await processAllImages(rawMarkdown, weeklyId, xxxCodes);

    // 4. 下載 Drive 高解、以同名覆蓋 Supabase
    await updateProgress('replacing_images', `下載並替換 ${xxxCodes.length} 張高解析度圖片...`);
    try {
      const outcome = await replaceWithDriveHighRes({
        weeklyId,
        xxxToDriveFile,
        providerToken: driveToken,
        onProgress: async (msg) => updateProgress('replacing_images', msg),
      });
      console.log(
        `[replacing_images] replaced=${outcome.replaced}/${outcome.driveTotal}`,
      );
      await writeAuditLog({
        user_email: userEmail || null,
        action: 'image_match',
        table_name: null,
        record_id: null,
        old_data: null,
        new_data: null,
        metadata: {
          weekly_id: weeklyId,
          total_replaced: outcome.replaced,
          drive_total: outcome.driveTotal,
        },
      });
    } catch (err) {
      console.error('[replacing_images] Error:', err);
      await updateProgress('replacing_images', '高解替換失敗，保留低解析度繼續匯入...');
    }

    // 5. 上傳 original.md
    await updateProgress('uploading_original', '上傳原始檔案...');
    await uploadMarkdown(weeklyId, 'original.md', markdownWithUrls);

    // 6. AI 解析
    await updateProgress('ai_parsing', 'AI 解析中...');
    const parsed: ParsedWeekly = await parseWeeklyMarkdown(markdownWithUrls, weeklyId);

    // 7. 生成並上傳 clean.md
    await updateProgress('uploading_clean', '上傳整理後檔案...');
    const cleanMarkdown = await generateCleanMarkdown(markdownWithUrls, parsed);
    await uploadMarkdown(weeklyId, 'clean.md', cleanMarkdown);

    // 8. 匯入 docs 版文稿（含 AI 生成 description）
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

    // 9. AI 改寫為 digital 版
    let rewrittenCount = 0;
    const digitalArticles: { id: number; content: string }[] = [];
    await updateProgress('ai_rewriting', `AI 改寫中... 0/${totalArticles}`);

    for (const category of parsed.categories) {
      for (const article of category.articles) {
        const rewritten = await rewriteForDigital(article.title, article.content, weeklyId, category.name);

        const t = normalizeNumbers(rewritten.title);
        const d = normalizeNumbers(rewritten.description);
        const c = normalizeNumbers(rewritten.content);
        const totalConv = t.conversions.length + d.conversions.length + c.conversions.length;
        if (totalConv > 0) {
          console.log(`[normalize-numbers] "${rewritten.title.slice(0, 40)}": ${totalConv} conversions`);
        }

        const inserted = await insertArticle({
          weekly_id: weeklyId,
          category_id: category.category_id,
          platform: 'digital',
          title: t.text,
          description: d.text,
          content: c.text,
        });

        digitalArticles.push({ id: inserted.id, content: c.text });

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
            model: 'opus',
            source_title: article.title,
            number_conversions: totalConv,
          },
        });

        rewrittenCount++;
        await updateProgress('ai_rewriting', `AI 改寫中... ${rewrittenCount}/${totalArticles}`);
      }
    }

    // 10. 生成語音和字幕
    let audioCount = 0;
    await updateProgress('generating_audio', `語音生成中... 0/${digitalArticles.length}`);

    for (const article of digitalArticles) {
      try {
        const result = await generateArticleAudio(weeklyId, article.id, article.content, async (msg) => {
          await updateProgress('generating_audio', `語音生成 ${audioCount + 1}/${digitalArticles.length} — ${msg}`);
        });
        console.log(`[generating_audio] Article ${article.id}: ${result.duration.toFixed(1)}s`);
      } catch (err) {
        // 語音生成失敗不阻擋整個匯入流程
        console.error(`[generating_audio] Article ${article.id} failed:`, err);
      }
      audioCount++;
      await updateProgress('generating_audio', `語音生成中... ${audioCount}/${digitalArticles.length}`);
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
