import { supabase } from './supabase.js';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { ImportStep } from '../types/index.js';

export interface ImportProgressUpdate {
  step: ImportStep;
  progress?: string;
  error?: string;
}

export interface SessionOutputMessage {
  type: 'user' | 'assistant' | 'system';
  message?: {
    content?: string;
  };
  sessionId?: string;
  timestamp?: string;
}

export interface SessionOutputUpdate {
  sessionId: string;
  data: SessionOutputMessage;
  timestamp: string;
}

export type ProgressCallback = (update: ImportProgressUpdate) => void;
export type SessionOutputCallback = (update: SessionOutputUpdate) => void;

export interface SubscribeOptions {
  onProgress?: ProgressCallback;
  onSessionOutput?: SessionOutputCallback;
}

/**
 * 訂閱匯入進度 Realtime channel（包含 AI session 輸出）
 */
export function subscribeToImportProgress(
  weeklyId: number,
  options: SubscribeOptions | ProgressCallback
): RealtimeChannel {
  // 支援舊版 callback 格式
  const opts: SubscribeOptions = typeof options === 'function'
    ? { onProgress: options }
    : options;

  const channel = supabase
    .channel(`import:${weeklyId}`)
    .on('broadcast', { event: 'progress' }, (payload) => {
      const update = payload.payload as ImportProgressUpdate;
      opts.onProgress?.(update);
    })
    .on('broadcast', { event: 'session_output' }, (payload) => {
      const update = payload.payload as SessionOutputUpdate;
      opts.onSessionOutput?.(update);
    })
    .subscribe();

  return channel;
}

/**
 * 取消訂閱
 */
export function unsubscribeFromImportProgress(channel: RealtimeChannel): void {
  supabase.removeChannel(channel);
}

/**
 * 從 session output 提取文字內容
 */
export function extractTextFromSessionOutput(update: SessionOutputUpdate): string | null {
  const { data } = update;

  if (!data.message?.content) return null;

  return data.message.content;
}

// =====================
// Audio 語音生成進度
// =====================

export interface AudioProgressUpdate {
  status: 'processing' | 'completed' | 'failed';
  message: string;
  mp3Url?: string;
  srtUrl?: string;
  duration?: number;
}

export type AudioProgressCallback = (update: AudioProgressUpdate) => void;

export function subscribeToAudioProgress(
  articleId: number,
  callback: AudioProgressCallback
): RealtimeChannel {
  const channel = supabase
    .channel(`audio:${articleId}`)
    .on('broadcast', { event: 'progress' }, (payload) => {
      callback(payload.payload as AudioProgressUpdate);
    })
    .subscribe();

  return channel;
}

export function unsubscribeFromAudioProgress(channel: RealtimeChannel): void {
  supabase.removeChannel(channel);
}

// =====================
// Book Upload 電子書上傳進度
// =====================

export type BookUploadStep = 'compressing' | 'uploading' | 'thumbnail' | 'saving' | 'completed' | 'failed';

export interface BookUploadProgressUpdate {
  step: BookUploadStep;
  progress?: string;
  error?: string;
  book?: Record<string, unknown>;
}

export type BookUploadProgressCallback = (update: BookUploadProgressUpdate) => void;

export function subscribeToBookUploadProgress(
  taskId: string,
  callback: BookUploadProgressCallback
): RealtimeChannel {
  const channel = supabase
    .channel(`book-upload:${taskId}`)
    .on('broadcast', { event: 'progress' }, (payload) => {
      callback(payload.payload as BookUploadProgressUpdate);
    })
    .subscribe();

  return channel;
}

export function unsubscribeFromBookUploadProgress(channel: RealtimeChannel): void {
  supabase.removeChannel(channel);
}

/**
 * 從 weekly 表讀取當前匯入狀態
 */
export async function getLatestImportStatus(weeklyId: number): Promise<ImportProgressUpdate | null> {
  const { data, error } = await supabase
    .from('weekly')
    .select('import_step, import_progress, import_error')
    .eq('week_number', weeklyId)
    .maybeSingle();  // 使用 maybeSingle 避免查無資料時報錯

  if (error) {
    console.error('Error fetching import status:', error);
    return null;
  }

  // 查無資料
  if (!data) {
    return null;
  }

  // 如果沒有進行中的匯入，返回 null
  if (!data?.import_step) {
    return null;
  }

  return {
    step: data.import_step as ImportStep,
    progress: data.import_progress || undefined,
    error: data.import_error || undefined,
  };
}
