// API and Worker types

export type ImportStep =
  | 'starting'
  | 'exporting_docs'
  | 'converting_images'
  | 'uploading_original'
  | 'ai_parsing'
  | 'uploading_clean'
  | 'importing_docs'
  | 'ai_rewriting'
  | 'importing_digital'
  | 'completed'
  | 'failed';

export interface ImportProgress {
  step: ImportStep;
  progress?: string;
  error?: string;
}

export interface ImportRequest {
  doc_url: string;
  weekly_id: number;
  user_email: string;
  drive_folder_url?: string;
  provider_token?: string;
}

export interface RewriteRequest {
  article_id: number;
  user_email: string;
}

export interface ApiError {
  error: string;
  message: string;
}

// Step display information
export interface StepInfo {
  key: ImportStep;
  label: string;
  description: string;
}

export const IMPORT_STEPS: StepInfo[] = [
  { key: 'starting', label: '初始化', description: '準備匯入環境' },
  { key: 'exporting_docs', label: '下載文件', description: '從 Google Docs 下載 markdown' },
  { key: 'converting_images', label: '處理圖片', description: '提取並上傳圖片' },
  { key: 'uploading_original', label: '上傳原稿', description: '儲存原始 markdown' },
  { key: 'ai_parsing', label: 'AI 解析', description: '解析 markdown 為結構化資料' },
  { key: 'uploading_clean', label: '上傳整理', description: '儲存整理後的 markdown' },
  { key: 'importing_docs', label: '匯入原稿', description: '將原稿匯入資料庫' },
  { key: 'ai_rewriting', label: 'AI 改寫', description: '改寫為數位版' },
  { key: 'importing_digital', label: '匯入數位版', description: '將數位版匯入資料庫' },
  { key: 'completed', label: '完成', description: '匯入完成' },
];

export function getStepIndex(step: ImportStep): number {
  const index = IMPORT_STEPS.findIndex((s) => s.key === step);
  return index === -1 ? 0 : index;
}

export function getStepInfo(step: ImportStep): StepInfo | undefined {
  return IMPORT_STEPS.find((s) => s.key === step);
}
