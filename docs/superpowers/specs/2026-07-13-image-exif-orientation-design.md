# Image EXIF Orientation Design

## Goal

Auto-rotate uploaded images per their EXIF orientation tag before storing them in Supabase, so cameras / phones that set `Orientation != 1` don't render sideways or upside-down in the dashboard and tzuchi-weekly.

## Motivation

Some editors upload photos straight from phones or cameras that write JPEG EXIF `Orientation` tags (values 3, 6, 8) instead of physically rotating pixels. Browsers that honor `image-orientation: from-image` (Chrome, Firefox) will render such images correctly, but the current pipeline runs the buffer through `sharp` without a rotate step, so the resulting compressed JPEG has pixels in original bitmap orientation AND retains the EXIF tag inconsistently — depending on sharp / libvips version, the result varies between browsers.

`worker/src/services/book-upload.ts:55` already uses `sharp(buf).rotate()` — the same fix belongs in `image-compressor.ts`.

## Scope

**In scope:**
- Insert `.rotate()` (no-arg — reads EXIF and applies) into `image-compressor.ts`'s sharp pipeline, before other transforms.

**Out of scope:**
- Backfill of previously uploaded images.
- SVG orientation (SVG has no EXIF; compressImage already bypasses sharp for SVG via try/catch and returns the original buffer — unaffected).
- Video / animated images.

## Design

### The change

`worker/src/services/image-compressor.ts`:

```diff
- const image = sharp(buffer);
- const metadata = await image.metadata();
+ const image = sharp(buffer).rotate();  // reads EXIF orientation, applies rotation, strips tag
+ const metadata = await image.metadata();
```

Post-rotation `image.metadata()` returns the rotated width/height, so the existing `metadata.width > MAX_WIDTH` resize check works correctly against physical orientation (a portrait photo taken by a phone in landscape mode with `Orientation=6` was previously seen as `width=4032, height=3024` — post-rotate it becomes `width=3024, height=4032`, which is the correct visual width for the resize test).

### Sharp `.rotate()` behavior (no argument)

- Reads JPEG EXIF `Orientation` tag (also TIFF, HEIC).
- Applies the rotation to pixel data.
- Strips the orientation tag from output metadata.
- No-op for images with `Orientation == 1` or no EXIF.
- Safe for PNG (no EXIF; sharp gracefully passes through).
- Errors are caught by the existing outer try/catch → falls through to "return buffer as-is."

## Testing

**Unit:**
- Feed `compressImage` a JPEG buffer with EXIF Orientation=6, assert result width/height matches the rotated dimensions.
- Feed a PNG (no EXIF) → same as before, no regression.
- Feed an SVG → still bypassed, no regression.

**Manual:**
- Editor uploads a phone photo taken in portrait mode into a weekly. Verify article page displays it upright.

## Rollout

- Merge to `main`.
- Rebuild worker on production: `docker compose up -d --build worker`.
- Coupled with the deterministic image mapping change ([`2026-07-13-deterministic-image-mapping-design.md`](./2026-07-13-deterministic-image-mapping-design.md)) — one deploy covers both.
- No config, no feature flag, no data migration.

## Non-goals

- No new EXIF metadata preservation. Stripping EXIF (orientation, GPS, camera) is a privacy plus — leave the strip behavior implicit via sharp's default output.
