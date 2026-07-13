import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import {
  getWeekly,
  setWeeklyDriveFolderUrl,
  insertAuditLog,
  broadcastImageReplaceProgress,
} from '../services/supabase.js';
import { extractFolderId, listImagesRecursive, type DriveFile } from '../services/google-drive.js';
import {
  getServiceAccessToken,
  isServiceAccountConfigured,
} from '../services/google-drive-auth.js';
import { replaceWithDriveHighRes } from '../services/image-matcher.js';
import { parseDrivePrefix, tripleKey } from '../services/image-code.js';

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

          await broadcastImageReplaceProgress(taskId, {
            step: 'matching',
            progress: '列出 Drive 圖片並解析編號...',
          });

          // Standalone re-replace: no doc-count check (allow partial replace,
          // e.g. editor updated only a few images in Drive). Still validate:
          // every file must parse to x-x-x, no duplicates.
          const driveFiles = await listImagesRecursive(driveToken, driveFolderId);
          const xxxToDriveFile = new Map<string, DriveFile>();
          const unparseable: string[] = [];
          const duplicates: { xxx: string; files: string[] }[] = [];
          const seenAt = new Map<string, string[]>();
          for (const file of driveFiles) {
            const prefix = parseDrivePrefix(file.name);
            if (!prefix) {
              unparseable.push(file.name);
              continue;
            }
            const xxx = tripleKey(prefix);
            const list = seenAt.get(xxx);
            if (list) {
              list.push(file.name);
            } else {
              seenAt.set(xxx, [file.name]);
              xxxToDriveFile.set(xxx, file);
            }
          }
          for (const [xxx, files] of seenAt) {
            if (files.length > 1) duplicates.push({ xxx, files });
          }
          if (unparseable.length > 0) {
            await broadcastImageReplaceProgress(taskId, {
              step: 'failed',
              error: `Drive 資料夾內有無法解析編號的檔案：${unparseable.join(', ')}`,
            });
            return;
          }
          if (duplicates.length > 0) {
            const summary = duplicates
              .map((d) => `x-x-x=${d.xxx}（${d.files.join(', ')}）`)
              .join('；');
            await broadcastImageReplaceProgress(taskId, {
              step: 'failed',
              error: `Drive 資料夾內同一個編號出現多次：${summary}`,
            });
            return;
          }

          const outcome = await replaceWithDriveHighRes({
            weeklyId,
            xxxToDriveFile,
            providerToken: driveToken,
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
              total_replaced: outcome.replaced,
              drive_total: outcome.driveTotal,
            },
          });

          await broadcastImageReplaceProgress(taskId, {
            step: 'completed',
            progress: `完成，共替換 ${outcome.replaced} 張圖片`,
            replaced: outcome.replaced,
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
