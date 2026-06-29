import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import {
  getWeekly,
  setWeeklyDriveFolderUrl,
  downloadMarkdown,
  insertAuditLog,
  broadcastImageReplaceProgress,
} from '../services/supabase.js';
import { extractFolderId } from '../services/google-drive.js';
import {
  getServiceAccessToken,
  isServiceAccountConfigured,
} from '../services/google-drive-auth.js';
import { matchAndReplacePerCategory } from '../services/image-matcher.js';
import { parseWeeklyMarkdown } from '../services/ai-parser.js';

const FOLDER_URL_RE = /\/folders\/([a-zA-Z0-9_-]+)/;

export const weeklyRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * 從 Drive 補圖（已上架週報用）
   * POST /weekly/:id/replace-images
   * Body: { drive_folder_url?, provider_token?, user_email? }
   * - drive_folder_url 沒給就用 weekly.drive_folder_url
   * - 給了就同時 update weekly.drive_folder_url（下次預設值）
   * 回應 202 + task_id，訂閱 `image-replace:{task_id}` channel 看進度
   */
  fastify.post<{
    Params: { id: string };
    Body: { drive_folder_url?: string; provider_token?: string; user_email?: string };
  }>(
    '/:id/replace-images',
    {
      preHandler: [requireAuth],
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const weeklyId = parseInt(request.params.id, 10);
      if (!weeklyId || Number.isNaN(weeklyId)) {
        return reply.status(400).send({ error: 'INVALID_ID', message: 'Invalid weekly id' });
      }

      const weekly = await getWeekly(weeklyId);
      if (!weekly) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: `Weekly ${weeklyId} not found` });
      }

      const { drive_folder_url: bodyFolderUrl, provider_token, user_email } = request.body || {};
      const driveFolderUrl = bodyFolderUrl || weekly.drive_folder_url;

      if (!driveFolderUrl || !FOLDER_URL_RE.test(driveFolderUrl)) {
        return reply.status(400).send({
          error: 'INVALID_DRIVE_FOLDER_URL',
          message: '請提供有效的 Google Drive 資料夾 URL',
        });
      }

      const driveFolderId = extractFolderId(driveFolderUrl)!;

      const saConfigured = isServiceAccountConfigured();
      if (!saConfigured && !provider_token) {
        return reply.status(400).send({
          error: 'NO_DRIVE_AUTH',
          message: 'Drive 認證不足：service account 未設定且 user OAuth token 缺失',
        });
      }

      // 若使用者送了新的 folder URL，存進 weekly 當作下次預設
      if (bodyFolderUrl && bodyFolderUrl !== weekly.drive_folder_url) {
        try {
          await setWeeklyDriveFolderUrl(weeklyId, bodyFolderUrl);
        } catch (err) {
          request.log.warn({ err }, 'Failed to persist drive_folder_url');
        }
      }

      const taskId = randomUUID();
      reply.status(202).send({ success: true, task_id: taskId, weekly_id: weeklyId });

      // 背景處理
      (async () => {
        try {
          await broadcastImageReplaceProgress(taskId, {
            step: 'preparing',
            progress: '準備中...',
          });

          // 取得 Drive token：SA 優先、OAuth fallback
          let driveToken: string | null = null;
          try {
            if (saConfigured) driveToken = await getServiceAccessToken();
          } catch (err) {
            console.warn('[replace-images] SA token failed, will try user token:', err);
          }
          if (!driveToken && provider_token) driveToken = provider_token;
          if (!driveToken) {
            await broadcastImageReplaceProgress(taskId, {
              step: 'failed',
              error: '無 Drive 認證可用',
            });
            return;
          }

          // 從 storage 抓回原始 markdown 作為比對依據
          const originalMd = await downloadMarkdown(weeklyId, 'original.md');
          if (!originalMd) {
            await broadcastImageReplaceProgress(taskId, {
              step: 'failed',
              error: '找不到 original.md，此週報可能未經 import 流程匯入',
            });
            return;
          }

          await broadcastImageReplaceProgress(taskId, {
            step: 'matching',
            progress: 'AI 解析週報結構...',
          });

          // per-category 比對需要 ParsedWeekly 拿到 image→category 對應
          const parsed = await parseWeeklyMarkdown(originalMd, weeklyId);

          await broadcastImageReplaceProgress(taskId, {
            step: 'matching',
            progress: 'AI 圖片比對中...',
          });

          const outcome = await matchAndReplacePerCategory({
            weeklyId,
            parsed,
            providerToken: driveToken,
            driveFolderId,
            onProgress: async (msg) => {
              await broadcastImageReplaceProgress(taskId, {
                step: 'replacing',
                progress: msg,
              });
            },
          });

          await insertAuditLog({
            user_email: user_email || null,
            action: 'image_match',
            table_name: 'weekly',
            record_id: weeklyId,
            old_data: null,
            new_data: null,
            metadata: {
              weekly_id: weeklyId,
              step: 'replace_images',
              drive_folder_url: driveFolderUrl,
              strategy: outcome.strategy,
              total_replaced: outcome.totalReplaced,
              prefix_matched: outcome.prefixMatched,
              vision_matched: outcome.visionMatched,
              unparseable_matched: outcome.unparseableMatched,
              drive_total: outcome.driveTotal,
              low_res_total: outcome.lowResTotal,
              orphan_low_after: outcome.orphanLowAfter,
              unparseable_high_res: outcome.unparseableHighRes,
              conflict_triples: outcome.conflictTriples,
            },
          });

          await broadcastImageReplaceProgress(taskId, {
            step: 'completed',
            progress: `完成，共替換 ${outcome.totalReplaced} 張圖片`,
            replaced: outcome.totalReplaced,
          });
        } catch (error) {
          request.log.error({ err: error }, '[replace-images] Failed');
          await broadcastImageReplaceProgress(taskId, {
            step: 'failed',
            error: error instanceof Error ? error.message : '替換失敗',
          }).catch(() => {});
        }
      })().catch(() => {});
    },
  );
};
