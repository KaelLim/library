import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { compressImage } from '../../src/services/image-compressor.js';

/**
 * Verify EXIF orientation is applied to pixels before compression.
 * We synthesize a 100×200 portrait JPEG, then write EXIF Orientation=6
 * (rotate 90° CW → visual dims become 200×100 landscape). compressImage
 * must return a JPEG whose metadata reports the landscape dims.
 */

async function buildPortraitJpegWithOrientation(orientation: number): Promise<Buffer> {
  // Sharp accepts a withMetadata() config where exif is a nested object.
  // We write the orientation tag onto a small solid-color PNG-source JPEG.
  return sharp({
    create: {
      width: 100,
      height: 200,
      channels: 3,
      background: { r: 128, g: 64, b: 200 },
    },
  })
    .jpeg()
    .withMetadata({ orientation })
    .toBuffer();
}

describe('compressImage EXIF rotation', () => {
  it('applies orientation=6 (rotate 90° CW) so visual dims are landscape', async () => {
    const input = await buildPortraitJpegWithOrientation(6);
    const { buffer, mimeType } = await compressImage(input, 'image/jpeg');
    expect(mimeType).toBe('image/jpeg');
    const meta = await sharp(buffer).metadata();
    // After rotation: 100×200 becomes 200×100.
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(100);
    // Sharp's rotate() strips the orientation tag from output.
    expect(meta.orientation).toBeUndefined();
  });

  it('leaves orientation=1 alone (no-op rotation)', async () => {
    const input = await buildPortraitJpegWithOrientation(1);
    const { buffer } = await compressImage(input, 'image/jpeg');
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(200);
  });
});
