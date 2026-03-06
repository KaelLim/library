import { spawn } from 'child_process';
import { writeFile, readFile, unlink, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

export interface CompressionOptions {
  /**
   * 壓縮品質等級
   * - 'screen': 最小檔案，72 dpi（適合螢幕瀏覽）
   * - 'ebook': 中等品質，150 dpi（適合電子書，推薦）
   * - 'printer': 高品質，300 dpi（適合列印）
   * - 'prepress': 最高品質，300 dpi（適合印刷出版）
   */
  quality?: 'screen' | 'ebook' | 'printer' | 'prepress';

  /**
   * 圖片 DPI（覆蓋 quality 預設值）
   */
  imageDpi?: number;

  /**
   * 是否保留可搜尋文字
   */
  preserveText?: boolean;
}

const QUALITY_SETTINGS = {
  screen: { dpi: 72, colorImageResolution: 72 },
  ebook: { dpi: 150, colorImageResolution: 150 },
  printer: { dpi: 300, colorImageResolution: 300 },
  prepress: { dpi: 300, colorImageResolution: 300 },
};

/**
 * 檢查 Ghostscript 是否可用
 */
export async function isGhostscriptAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const gs = spawn('gs', ['--version']);
    gs.on('error', () => resolve(false));
    gs.on('close', (code) => resolve(code === 0));
  });
}

/**
 * 使用 Ghostscript 壓縮 PDF
 */
export async function compressPdf(
  pdfBuffer: Buffer,
  options: CompressionOptions = {}
): Promise<{ buffer: Buffer; originalSize: number; compressedSize: number; ratio: number }> {
  const originalSize = pdfBuffer.length;
  const quality = options.quality || 'ebook';
  const VALID_QUALITIES = ['screen', 'ebook', 'printer', 'prepress'] as const;
  if (!VALID_QUALITIES.includes(quality as any)) {
    throw new Error(`Invalid quality: ${quality}. Must be one of: ${VALID_QUALITIES.join(', ')}`);
  }
  const settings = QUALITY_SETTINGS[quality];
  const dpi = options.imageDpi || settings.dpi;
  if (dpi < 50 || dpi > 600) {
    throw new Error(`Invalid DPI: ${dpi}. Must be between 50 and 600`);
  }

  // 檢查 Ghostscript 是否可用
  const gsAvailable = await isGhostscriptAvailable();

  if (!gsAvailable) {
    console.log('[PDF Compressor] Ghostscript not available, returning original PDF');
    return {
      buffer: pdfBuffer,
      originalSize,
      compressedSize: originalSize,
      ratio: 1,
    };
  }

  // 建立暫存目錄
  const tempDir = await mkdtemp(join(tmpdir(), 'pdf-compress-'));
  const inputPath = join(tempDir, `input-${randomUUID()}.pdf`);
  const outputPath = join(tempDir, `output-${randomUUID()}.pdf`);

  try {
    // 寫入輸入檔案
    await writeFile(inputPath, pdfBuffer);

    // Ghostscript 參數
    const gsArgs = [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      `-dPDFSETTINGS=/${quality}`,
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      // 圖片壓縮設定
      '-dColorImageDownsampleType=/Bicubic',
      `-dColorImageResolution=${dpi}`,
      '-dGrayImageDownsampleType=/Bicubic',
      `-dGrayImageResolution=${dpi}`,
      '-dMonoImageDownsampleType=/Bicubic',
      `-dMonoImageResolution=${dpi}`,
      // 保留文字可搜尋
      '-dEmbedAllFonts=true',
      '-dSubsetFonts=true',
      // 輸出
      `-sOutputFile=${outputPath}`,
      inputPath,
    ];

    console.log(`[PDF Compressor] Compressing with quality="${quality}", dpi=${dpi}`);

    // 執行 Ghostscript
    await new Promise<void>((resolve, reject) => {
      const gs = spawn('gs', gsArgs);

      let stderr = '';
      gs.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      gs.on('error', (err) => {
        reject(new Error(`Ghostscript error: ${err.message}`));
      });

      gs.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Ghostscript exited with code ${code}: ${stderr}`));
        }
      });
    });

    // 讀取壓縮後的檔案
    const compressedBuffer = await readFile(outputPath);
    const compressedSize = compressedBuffer.length;
    const ratio = compressedSize / originalSize;

    console.log(
      `[PDF Compressor] Original: ${formatBytes(originalSize)}, ` +
      `Compressed: ${formatBytes(compressedSize)}, ` +
      `Ratio: ${(ratio * 100).toFixed(1)}%`
    );

    // 如果壓縮後反而更大，返回原始檔案
    if (compressedSize >= originalSize) {
      console.log('[PDF Compressor] Compressed file is larger, using original');
      return {
        buffer: pdfBuffer,
        originalSize,
        compressedSize: originalSize,
        ratio: 1,
      };
    }

    return {
      buffer: compressedBuffer,
      originalSize,
      compressedSize,
      ratio,
    };
  } finally {
    // 清理暫存檔案
    try {
      await unlink(inputPath).catch(() => {});
      await unlink(outputPath).catch(() => {});
    } catch {
      // 忽略清理錯誤
    }
  }
}

/**
 * 格式化檔案大小
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 從 PDF 第一頁擷取 JPEG 縮圖
 */
export async function extractPdfThumbnail(
  pdfBuffer: Buffer,
  options: { dpi?: number; quality?: number } = {}
): Promise<Buffer | null> {
  const dpi = options.dpi || 150;
  const jpegQ = options.quality || 85;

  const gsAvailable = await isGhostscriptAvailable();
  if (!gsAvailable) {
    console.warn('[PDF Thumbnail] Ghostscript not available');
    return null;
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'pdf-thumb-'));
  const inputPath = join(tempDir, `input-${randomUUID()}.pdf`);
  const outputPath = join(tempDir, `thumb-${randomUUID()}.jpg`);

  try {
    await writeFile(inputPath, pdfBuffer);

    const gsArgs = [
      '-dFirstPage=1',
      '-dLastPage=1',
      '-sDEVICE=jpeg',
      `-dJPEGQ=${jpegQ}`,
      `-r${dpi}`,
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      '-dSAFER',
      `-sOutputFile=${outputPath}`,
      inputPath,
    ];

    await new Promise<void>((resolve, reject) => {
      const gs = spawn('gs', gsArgs);
      let stderr = '';
      gs.stderr.on('data', (data) => { stderr += data.toString(); });
      gs.on('error', (err) => reject(new Error(`Ghostscript error: ${err.message}`)));
      gs.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Ghostscript exited with code ${code}: ${stderr}`));
      });
    });

    const thumbBuffer = await readFile(outputPath);
    console.log(`[PDF Thumbnail] Generated: ${formatBytes(thumbBuffer.length)}`);
    return thumbBuffer;
  } catch (err) {
    console.error('[PDF Thumbnail] Failed:', err);
    return null;
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

/**
 * 快速壓縮（適合電子書）
 */
export async function compressPdfForEbook(pdfBuffer: Buffer): Promise<Buffer> {
  const result = await compressPdf(pdfBuffer, { quality: 'ebook' });
  return result.buffer;
}

/**
 * 高品質壓縮（適合列印）
 */
export async function compressPdfHighQuality(pdfBuffer: Buffer): Promise<Buffer> {
  const result = await compressPdf(pdfBuffer, { quality: 'printer' });
  return result.buffer;
}
