import { uploadImage } from './supabase.js';
import { compressImage } from './image-compressor.js';

interface InlineImage {
  fullMatch: string;
  altText: string;
  mimeType: string;
  base64: string;
}

interface RefDef {
  fullMatch: string;
  refId: string;
  mimeType: string;
  base64: string;
}

// `![alt](data:image/png;base64,xxxxx)`
const BASE64_IMAGE_REGEX = /!\[([^\]]*)\]\(data:(image\/[^;]+);base64,([^)]+)\)/g;

// `[refId]: <data:image/png;base64,xxxxx>` (or without angle brackets)
const REFERENCE_IMAGE_DEF_REGEX = /\[([^\]]+)\]:\s*<?data:(image\/[^;]+);base64,([^\s>]+)>?/g;

// `![alt][refId]`
const REFERENCE_IMAGE_USE_REGEX = /!\[([^\]]*)\]\[([^\]]+)\]/g;

function findInlineBase64(markdown: string): InlineImage[] {
  const out: InlineImage[] = [];
  BASE64_IMAGE_REGEX.lastIndex = 0;
  let match;
  while ((match = BASE64_IMAGE_REGEX.exec(markdown)) !== null) {
    out.push({
      fullMatch: match[0],
      altText: match[1],
      mimeType: match[2],
      base64: match[3],
    });
  }
  return out;
}

function findReferenceDefs(markdown: string): RefDef[] {
  const out: RefDef[] = [];
  REFERENCE_IMAGE_DEF_REGEX.lastIndex = 0;
  let match;
  while ((match = REFERENCE_IMAGE_DEF_REGEX.exec(markdown)) !== null) {
    out.push({
      fullMatch: match[0],
      refId: match[1],
      mimeType: match[2],
      base64: match[3],
    });
  }
  return out;
}

/**
 * Extract every base64 image (reference defs + inline) from `markdown` in
 * document order, upload each with the corresponding `xxxCodes[i]` as its
 * Storage filename (no extension), and return the markdown with data URLs
 * replaced by public URLs.
 *
 * `xxxCodes.length` MUST equal the extracted image count. The pipeline's
 * upstream validation step is responsible for that invariant; a mismatch
 * here indicates a regex drift or unvalidated call site — throw.
 */
export async function processAllImages(
  markdown: string,
  weeklyId: number,
  xxxCodes: string[],
): Promise<string> {
  // Reference-style defs come first in Docs export order (they typically
  // appear at the bottom of the document but represent the images defined
  // for reference-style usages that appeared inline). We treat reference
  // defs as the primary source, then any inline base64 images.
  const refDefs = findReferenceDefs(markdown);
  const inline = findInlineBase64(markdown);
  const total = refDefs.length + inline.length;

  if (total !== xxxCodes.length) {
    throw new Error(
      `[image-processor] xxxCodes length ${xxxCodes.length} != extracted base64 image count ${total}. This should have been caught by validateDocImagesAgainstDrive; check regex or call site.`,
    );
  }

  if (total === 0) return markdown;

  // Assign codes in order: refDefs first, then inline. Both sub-lists
  // preserve document-order via their regex walk.
  let codeIdx = 0;
  const refUrlByRefId = new Map<string, string>();

  await Promise.all(
    refDefs.map(async (def) => {
      const xxx = xxxCodes[codeIdx++];
      const buffer = Buffer.from(def.base64, 'base64');
      const compressed = await compressImage(buffer, def.mimeType);
      const url = await uploadImage(weeklyId, xxx, compressed.buffer, compressed.mimeType);
      refUrlByRefId.set(def.refId, url);
    }),
  );

  const inlineReplacements = await Promise.all(
    inline.map(async (img) => {
      const xxx = xxxCodes[codeIdx++];
      const buffer = Buffer.from(img.base64, 'base64');
      const compressed = await compressImage(buffer, img.mimeType);
      const url = await uploadImage(weeklyId, xxx, compressed.buffer, compressed.mimeType);
      return { fullMatch: img.fullMatch, altText: img.altText, url };
    }),
  );

  // 1) Rewrite reference-style usages `![alt][refId]` → `![alt](URL)`.
  let processed = markdown.replace(REFERENCE_IMAGE_USE_REGEX, (fullMatch, altText, refId) => {
    const url = refUrlByRefId.get(refId);
    return url ? `![${altText}](${url})` : fullMatch;
  });

  // 2) Strip reference defs.
  processed = processed.replace(REFERENCE_IMAGE_DEF_REGEX, '');

  // 3) Rewrite inline base64.
  for (const { fullMatch, altText, url } of inlineReplacements) {
    processed = processed.replace(fullMatch, `![${altText}](${url})`);
  }

  return processed.trim();
}
