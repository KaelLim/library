import { subscribeToAudioProgress, unsubscribeFromAudioProgress } from '../services/realtime.js';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface AudioTask {
  articleId: number;
  articleTitle: string;
  status: 'processing' | 'completed' | 'failed';
  message: string;
  duration?: number;
}

type AudioStoreCallback = (tasks: AudioTask[]) => void;

class AudioStore {
  private _tasks: AudioTask[] = [];
  private _channels = new Map<number, RealtimeChannel>();
  private _listeners: AudioStoreCallback[] = [];

  get tasks(): AudioTask[] {
    return [...this._tasks];
  }

  /** 開始追蹤一篇文稿的音頻生成 */
  start(articleId: number, articleTitle: string): void {
    // 如果已有同篇正在 processing，不重複
    const existing = this._tasks.find(t => t.articleId === articleId);
    if (existing?.status === 'processing') return;

    // 移除舊的完成/失敗狀態
    this._tasks = this._tasks.filter(t => t.articleId !== articleId);

    // 加入新任務
    this._tasks.push({
      articleId,
      articleTitle,
      status: 'processing',
      message: '語音生成準備中...',
    });
    this.notify();

    // 清理舊 channel
    const oldChannel = this._channels.get(articleId);
    if (oldChannel) unsubscribeFromAudioProgress(oldChannel);

    // 訂閱 Realtime 進度
    const channel = subscribeToAudioProgress(articleId, (update) => {
      const task = this._tasks.find(t => t.articleId === articleId);
      if (!task) return;

      task.message = update.message;

      if (update.status === 'completed') {
        task.status = 'completed';
        task.message = `完成（${update.duration?.toFixed(0)} 秒音檔）`;
        task.duration = update.duration;
        this.cleanupChannel(articleId);
        // 8 秒後自動移除
        setTimeout(() => this.dismiss(articleId), 8000);
      } else if (update.status === 'failed') {
        task.status = 'failed';
        this.cleanupChannel(articleId);
      }

      this.notify();
    });

    this._channels.set(articleId, channel);
  }

  /** 手動關閉一個任務 */
  dismiss(articleId: number): void {
    this._tasks = this._tasks.filter(t => t.articleId !== articleId);
    this.cleanupChannel(articleId);
    this.notify();
  }

  subscribe(callback: AudioStoreCallback): () => void {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter(l => l !== callback);
    };
  }

  private cleanupChannel(articleId: number): void {
    const channel = this._channels.get(articleId);
    if (channel) {
      unsubscribeFromAudioProgress(channel);
      this._channels.delete(articleId);
    }
  }

  private notify(): void {
    const snapshot = this.tasks;
    for (const listener of this._listeners) {
      listener(snapshot);
    }
  }
}

export const audioStore = new AudioStore();
