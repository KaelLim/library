import { spawn } from 'child_process';
import { writeFile, readFile, unlink, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

export interface CompressionOptions {
  /**
   * 壓縮品質等級（保留介面相容性，qpdf 無損優化不區分品質）
   */
  quality?: 'screen' | 'ebook' | 'printer' | 'prepress';
}

/**
 * 檢查 qpdf 是否可用
 */
export async function isQpdfAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('qpdf', ['--version']);
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

/**
 * 檢查 Ghostscript 是否可用（用於縮圖擷取）
 */
export async function isGhostscriptAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const gs = spawn('gs', ['--version']);
    gs.on('error', () => resolve(false));
    gs.on('close', (code) => resolve(code === 0));
  });
}

/**
 * 使用 qpdf 無損優化 PDF
 * - 不會重新編碼內容，排版零風險
 * - 壓縮串流、移除冗餘物件、線性化（web 快速載入）
 */
export async function compressPdf(
  pdfBuffer: Buffer,
  _options: CompressionOptions = {}
): Promise<{ buffer: Buffer; originalSize: number; compressedSize: number; ratio: number }> {
  const originalSize = pdfBuffer.length;

  const qpdfAvailable = await isQpdfAvailable();
  if (!qpdfAvailable) {
    console.log('[PDF Compressor] qpdf not available, returning original PDF');
    return {
      buffer: pdfBuffer,
      originalSize,
      compressedSize: originalSize,
      ratio: 1,
    };
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'pdf-compress-'));
  const inputPath = join(tempDir, `input-${randomUUID()}.pdf`);
  const outputPath = join(tempDir, `output-${randomUUID()}.pdf`);

  try {
    await writeFile(inputPath, pdfBuffer);

    const qpdfArgs = [
      '--linearize',
      '--compress-streams=y',
      '--recompress-flate',
      '--object-streams=generate',
      inputPath,
      outputPath,
    ];

    console.log('[PDF Compressor] Optimizing with qpdf (lossless)...');

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('qpdf', qpdfArgs);

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (err) => {
        reject(new Error(`qpdf error: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`qpdf exited with code ${code}: ${stderr}`));
        }
      });
    });

    const compressedBuffer = await readFile(outputPath);
    const compressedSize = compressedBuffer.length;
    const ratio = compressedSize / originalSize;

    console.log(
      `[PDF Compressor] Original: ${formatBytes(originalSize)}, ` +
      `Optimized: ${formatBytes(compressedSize)}, ` +
      `Ratio: ${(ratio * 100).toFixed(1)}%`
    );

    if (compressedSize >= originalSize) {
      console.log('[PDF Compressor] Optimized file is larger, using original');
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
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
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
 * 無損優化 PDF（統一入口）
 */
export async function optimizePdf(pdfBuffer: Buffer): Promise<Buffer> {
  const result = await compressPdf(pdfBuffer);
  return result.buffer;
}
