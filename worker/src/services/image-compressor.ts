import sharp from 'sharp';

const MAX_WIDTH = 1920;
const JPEG_QUALITY = 80;

/**
 * 壓縮圖片：resize 到最大寬度 1920px + 轉為 JPG 品質 80%
 * 返回壓縮後的 Buffer 和 content type
 */
export async function compressImage(
  buffer: Buffer,
  originalMimeType: string
): Promise<{ buffer: Buffer; mimeType: string; extension: string }> {
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    let pipeline = image;

    // 只在超過最大寬度時才 resize
    if (metadata.width && metadata.width > MAX_WIDTH) {
      pipeline = pipeline.resize(MAX_WIDTH, null, { withoutEnlargement: true });
    }

    // 轉為 JPG
    const compressed = await pipeline
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    const ratio = ((1 - compressed.length / buffer.length) * 100).toFixed(1);
    console.log(
      `[ImageCompressor] ${(buffer.length / 1024).toFixed(0)}KB → ${(compressed.length / 1024).toFixed(0)}KB (${ratio}% 縮減, ${metadata.width}x${metadata.height} → max ${MAX_WIDTH}px)`
    );

    return {
      buffer: compressed,
      mimeType: 'image/jpeg',
      extension: 'jpg',
    };
  } catch (err) {
    // SVG 或無法處理的格式，保持原樣
    console.warn(`[ImageCompressor] 無法壓縮 (${originalMimeType})，保持原檔:`, err);
    const ext = originalMimeType.split('/')[1] || 'png';
    return { buffer, mimeType: originalMimeType, extension: ext };
  }
}
