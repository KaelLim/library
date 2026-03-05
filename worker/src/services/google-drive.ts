const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

/**
 * 從 Google Drive folder URL 提取 folder ID
 * https://drive.google.com/drive/folders/FOLDER_ID
 */
export function extractFolderId(url: string): string | null {
  const match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * 列出 Drive 資料夾下的所有檔案（支援共用硬碟）
 */
export async function listFiles(token: string, folderId: string): Promise<DriveFile[]> {
  const allFiles: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      pageSize: '100',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const resp = await fetch(`${DRIVE_API}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Drive API error ${resp.status}: ${err}`);
    }

    const data = await resp.json();
    allFiles.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allFiles;
}

/**
 * 遞迴列出資料夾下所有圖片檔（含子資料夾）
 */
export async function listImagesRecursive(token: string, folderId: string): Promise<DriveFile[]> {
  const files = await listFiles(token, folderId);
  const images: DriveFile[] = [];
  const folders: DriveFile[] = [];

  for (const file of files) {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      folders.push(file);
    } else if (file.mimeType.startsWith('image/')) {
      images.push(file);
    }
  }

  // 遞迴子資料夾
  for (const folder of folders) {
    const subImages = await listImagesRecursive(token, folder.id);
    images.push(...subImages);
  }

  return images;
}

/**
 * 下載單一檔案為 Buffer
 */
export async function downloadFile(token: string, fileId: string): Promise<Buffer> {
  const params = new URLSearchParams({
    alt: 'media',
    supportsAllDrives: 'true',
  });

  const resp = await fetch(`${DRIVE_API}/${fileId}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Drive download error ${resp.status}: ${err}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
