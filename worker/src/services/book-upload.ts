import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  broadcastBookUploadProgress,
  getBooksCategoryBySlug,
  insertAuditLog,
  insertBook,
  removeBookPdf,
  removeBookThumbnail,
  updateBook,
  uploadBookPdf,
  uploadBookThumbnail,
  type ThumbnailFormat,
} from './supabase.js';
import { compressPdf, extractPdfThumbnail } from './pdf-compressor.js';
import type { Book } from '../types/index.js';

export const MAX_COVER_SIZE = 10 * 1024 * 1024; // 10MB

/** JPEG / PNG / WebP magic-byte 檢查 */
export function isSupportedImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return true;
  if (
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  )
    return true;
  return false;
}

/** PDF magic-byte 檢查 */
export function isValidPdf(buf: Buffer): boolean {
  return buf.length >= 4 && buf.toString('ascii', 0, 4) === '%PDF';
}

function detectCoverFormat(buf: Buffer): ThumbnailFormat {
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return 'jpeg';
}

/** 方向校正 + 最大寬 1200px，保留原始格式 */
export async function normalizeCover(
  buf: Buffer
): Promise<{ buffer: Buffer; format: ThumbnailFormat }> {
  const format = detectCoverFormat(buf);
  let pipeline = sharp(buf).rotate().resize({ width: 1200, withoutEnlargement: true });
  if (format === 'png') pipeline = pipeline.png({ compressionLevel: 9 });
  else if (format === 'webp') pipeline = pipeline.webp({ quality: 85 });
  else pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
  return { buffer: await pipeline.toBuffer(), format };
}

const VALID_QUALITIES = ['screen', 'ebook', 'printer', 'prepress'] as const;
type Quality = (typeof VALID_QUALITIES)[number];

function resolveQuality(raw?: string): Quality {
  return VALID_QUALITIES.includes(raw as Quality) ? (raw as Quality) : 'ebook';
}

interface Logger {
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface BookCreateInput {
  rawPdfBuffer: Buffer;
  pdfFilename: string;
  coverBuffer: Buffer | null;
  fields: Record<string, string>;
  log?: Logger;
}

export interface BookCreateResult {
  taskId: string;
  title: string;
}

/**
 * 開始建立電子書（同步驗證 + 非同步背景處理 + 廣播）
 * 回傳 task_id 給呼叫者立即回 202。
 */
export function startBookCreate(input: BookCreateInput): BookCreateResult {
  const { rawPdfBuffer, pdfFilename, coverBuffer, fields, log } = input;
  const title = fields.title;
  if (!title) throw new Error('title is required');
  if (!isValidPdf(rawPdfBuffer)) throw new Error('上傳的檔案不是有效的 PDF');

  const taskId = randomUUID();

  // 背景處理：fire-and-forget
  (async () => {
    try {
      const compressionQuality = resolveQuality(fields.compression_quality);
      const skipCompression = fields.skip_compression === 'true';

      let pdfBuffer: Buffer = rawPdfBuffer;
      let compressionInfo: { originalSize: number; compressedSize: number; ratio: number } | null = null;

      if (!skipCompression) {
        await broadcastBookUploadProgress(taskId, { step: 'compressing', progress: '壓縮 PDF 中...' });
        const compressed = await compressPdf(rawPdfBuffer, { quality: compressionQuality });
        pdfBuffer = Buffer.from(compressed.buffer);
        compressionInfo = {
          originalSize: compressed.originalSize,
          compressedSize: compressed.compressedSize,
          ratio: compressed.ratio,
        };
      }

      await broadcastBookUploadProgress(taskId, { step: 'uploading', progress: '上傳 PDF 中...' });
      const storageResult = await uploadBookPdf(pdfBuffer, pdfFilename);

      // 縮圖：使用者上傳 > PDF 第一頁
      let thumbnailUrl = fields.thumbnail_url || null;
      if (!thumbnailUrl) {
        const uuid = storageResult.path.replace(/^books\//, '').replace(/\.pdf$/, '');
        let thumbBuffer: Buffer | null = null;
        let thumbFormat: ThumbnailFormat = 'jpeg';

        if (coverBuffer) {
          await broadcastBookUploadProgress(taskId, { step: 'thumbnail', progress: '處理封面中...' });
          const normalized = await normalizeCover(coverBuffer);
          thumbBuffer = normalized.buffer;
          thumbFormat = normalized.format;
        } else {
          await broadcastBookUploadProgress(taskId, { step: 'thumbnail', progress: '從 PDF 擷取封面中...' });
          thumbBuffer = await extractPdfThumbnail(pdfBuffer);
        }

        if (thumbBuffer) {
          thumbnailUrl = await uploadBookThumbnail(thumbBuffer, uuid, thumbFormat);
        }
      }

      let categoryId: number | undefined;
      if (fields.category_id) {
        categoryId = parseInt(fields.category_id, 10);
      } else if (fields.category_slug) {
        const category = await getBooksCategoryBySlug(fields.category_slug);
        if (category) categoryId = category.id;
      }

      await broadcastBookUploadProgress(taskId, { step: 'saving', progress: '寫入資料庫中...' });
      const book = await insertBook({
        category_id: categoryId || null,
        book_id: storageResult.uuid,
        title,
        introtext: fields.introtext || fields.description || null,
        catalogue: fields.catalogue || null,
        author: fields.author || null,
        author_introtext: fields.author_introtext || null,
        publisher: fields.publisher || null,
        book_date: fields.book_date || null,
        isbn: fields.isbn || null,
        pdf_path: storageResult.path,
        thumbnail_url: thumbnailUrl,
        language: fields.language || 'zh-TW',
        turn_page: (fields.turn_page as 'left' | 'right') || 'left',
        copyright: fields.copyright || null,
        download: fields.download !== 'false',
        online_purchase: fields.online_purchase || null,
        publish_date: fields.publish_date || null,
      });

      await insertAuditLog({
        user_email: fields.user_email || null,
        action: 'create_book',
        table_name: 'books',
        record_id: book.id,
        old_data: null,
        new_data: { title },
        metadata: {
          pdf_path: storageResult.path,
          compression: compressionInfo,
          cover_source: coverBuffer ? 'uploaded' : 'pdf_first_page',
        },
      });

      await broadcastBookUploadProgress(taskId, {
        step: 'completed',
        progress: '電子書建立成功',
        book: {
          id: book.id,
          book_id: book.book_id,
          title: book.title,
          thumbnail_url: book.thumbnail_url,
          pdf_path: book.pdf_path,
        },
      });
    } catch (error) {
      log?.error?.('[Books] Background processing error:', error);
      await broadcastBookUploadProgress(taskId, {
        step: 'failed',
        error: error instanceof Error ? error.message : '電子書建立失敗',
      }).catch(() => {});
    }
  })().catch(() => {});

  return { taskId, title };
}

export interface BookPdfReplaceInput {
  book: Book;
  rawPdfBuffer: Buffer;
  coverBuffer: Buffer | null;
  fields: Record<string, string>;
  userEmail?: string | null;
  log?: Logger;
}

export interface BookPdfReplaceResult {
  taskId: string;
  bookId: number;
}

/**
 * 開始替換電子書 PDF
 * book.book_id 不變（reader URL 維持），舊 PDF / 縮圖 DB 更新成功後才清除。
 */
export function startBookPdfReplace(input: BookPdfReplaceInput): BookPdfReplaceResult {
  const { book, rawPdfBuffer, coverBuffer, fields, userEmail, log } = input;
  if (!isValidPdf(rawPdfBuffer)) throw new Error('上傳的檔案不是有效的 PDF');

  const taskId = randomUUID();
  const regenerateThumbnail = fields.regenerate_thumbnail === 'true';

  (async () => {
    const oldPdfPath = book.pdf_path;
    const oldThumbnailUrl = book.thumbnail_url;
    let newPdfPath: string | null = null;
    let newThumbnailUrl: string | null = null;

    try {
      const compressionQuality = resolveQuality(fields.compression_quality);
      const skipCompression = fields.skip_compression === 'true';

      let pdfBuffer: Buffer = rawPdfBuffer;
      let compressionInfo: { originalSize: number; compressedSize: number; ratio: number } | null = null;

      if (!skipCompression) {
        await broadcastBookUploadProgress(taskId, { step: 'compressing', progress: '壓縮 PDF 中...' });
        const compressed = await compressPdf(rawPdfBuffer, { quality: compressionQuality });
        pdfBuffer = Buffer.from(compressed.buffer);
        compressionInfo = {
          originalSize: compressed.originalSize,
          compressedSize: compressed.compressedSize,
          ratio: compressed.ratio,
        };
      }

      await broadcastBookUploadProgress(taskId, { step: 'uploading', progress: '上傳 PDF 中...' });
      const storageResult = await uploadBookPdf(pdfBuffer);
      newPdfPath = storageResult.path;

      // 縮圖檔名沿用 book.book_id 維持 URL 穩定
      let thumbnailFilenameUuid = book.book_id;
      if (!thumbnailFilenameUuid && oldPdfPath) {
        thumbnailFilenameUuid = oldPdfPath.replace(/^books\//, '').replace(/\.pdf$/, '');
      }

      if (coverBuffer && thumbnailFilenameUuid) {
        await broadcastBookUploadProgress(taskId, { step: 'thumbnail', progress: '處理封面中...' });
        const normalized = await normalizeCover(coverBuffer);
        newThumbnailUrl = await uploadBookThumbnail(normalized.buffer, thumbnailFilenameUuid, normalized.format);
      } else if (regenerateThumbnail && thumbnailFilenameUuid) {
        await broadcastBookUploadProgress(taskId, { step: 'thumbnail', progress: '從新 PDF 擷取封面中...' });
        const thumbBuffer = await extractPdfThumbnail(pdfBuffer);
        if (thumbBuffer) {
          newThumbnailUrl = await uploadBookThumbnail(thumbBuffer, thumbnailFilenameUuid, 'jpeg');
        }
      }

      await broadcastBookUploadProgress(taskId, { step: 'saving', progress: '更新資料庫中...' });
      const dbUpdates: { pdf_path: string; thumbnail_url?: string } = { pdf_path: newPdfPath };
      if (newThumbnailUrl) dbUpdates.thumbnail_url = newThumbnailUrl;
      const updated = await updateBook(book.id, dbUpdates);

      if (oldPdfPath && oldPdfPath !== newPdfPath) {
        await removeBookPdf(oldPdfPath).catch((err) => {
          log?.warn?.({ err, oldPdfPath }, '[Books] 清除舊 PDF 失敗');
        });
      }
      if (newThumbnailUrl && oldThumbnailUrl && oldThumbnailUrl !== newThumbnailUrl) {
        await removeBookThumbnail(oldThumbnailUrl).catch((err) => {
          log?.warn?.({ err, oldThumbnailUrl }, '[Books] 清除舊縮圖失敗');
        });
      }

      await insertAuditLog({
        user_email: userEmail || fields.user_email || null,
        action: 'upload_pdf',
        table_name: 'books',
        record_id: book.id,
        old_data: { pdf_path: oldPdfPath, thumbnail_url: oldThumbnailUrl },
        new_data: { pdf_path: newPdfPath, thumbnail_url: newThumbnailUrl || oldThumbnailUrl },
        metadata: {
          compression: compressionInfo,
          thumbnail_source: coverBuffer ? 'uploaded' : regenerateThumbnail ? 'pdf_first_page' : 'kept_old',
        },
      });

      await broadcastBookUploadProgress(taskId, {
        step: 'completed',
        progress: 'PDF 替換成功',
        book: {
          id: updated.id,
          book_id: updated.book_id,
          title: updated.title,
          pdf_path: updated.pdf_path,
          thumbnail_url: updated.thumbnail_url,
        },
      });
    } catch (error) {
      log?.error?.({ err: error }, '[Books] PDF replace failed');
      if (newPdfPath && newPdfPath !== oldPdfPath) {
        await removeBookPdf(newPdfPath).catch(() => {});
      }
      await broadcastBookUploadProgress(taskId, {
        step: 'failed',
        error: error instanceof Error ? error.message : 'PDF 替換失敗',
      }).catch(() => {});
    }
  })().catch(() => {});

  return { taskId, bookId: book.id };
}
