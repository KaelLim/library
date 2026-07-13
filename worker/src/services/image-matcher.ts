import { downloadFile, type DriveFile } from './google-drive.js';
import { uploadImage } from './supabase.js';
import { compressImage } from './image-compressor.js';

export interface ReplaceOutcome {
  replaced: number;
  driveTotal: number;
}

/**
 * Download each Drive high-res file, compress, upsert into Supabase Storage
 * under the same `x-x-x` key used by the low-res upload. `xxxToDriveFile`
 * is produced by `validateDocImagesAgainstDrive`; every entry has been
 * verified to have exactly one Drive file with a parseable prefix, so this
 * function does no matching itself — it's a straight download/upload loop.
 */
export async function replaceWithDriveHighRes(args: {
  weeklyId: number;
  xxxToDriveFile: Map<string, DriveFile>;
  providerToken: string;
  onProgress?: (msg: string) => void;
}): Promise<ReplaceOutcome> {
  const { weeklyId, xxxToDriveFile, providerToken, onProgress } = args;
  const total = xxxToDriveFile.size;
  let replaced = 0;

  for (const [xxx, file] of xxxToDriveFile) {
    onProgress?.(`替換 ${xxx} ← ${file.name}`);
    const buffer = await downloadFile(providerToken, file.id);
    const compressed = await compressImage(buffer, file.mimeType);
    await uploadImage(weeklyId, xxx, compressed.buffer, compressed.mimeType);
    replaced += 1;
  }

  return { replaced, driveTotal: total };
}
