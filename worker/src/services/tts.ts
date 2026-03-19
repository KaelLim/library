import { execFile } from 'child_process';
import { writeFile, unlink, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { uploadToStorage } from './supabase.js';

const TTS_API_BASE = process.env.TTS_API_URL || 'https://tcm1.tzuchi-org.tw';

// 參考音頻路徑（打包在 Docker image 內）
const __dirname = dirname(fileURLToPath(import.meta.url));
const REF_AUDIO_PATH = resolve(__dirname, '../../assets/tts-ref.mp3');
const REF_TEXT_PATH = resolve(__dirname, '../../assets/tts-ref.txt');

interface TtsEvent {
  type: 'status' | 'progress' | 'done' | 'queue';
  message?: string;
  audio?: string; // base64 WAV
  sample_rate?: number;
  duration?: number;
  elapsed?: number;
  chunks?: number;
  total_chunks?: number;
}

export type TtsProgressCallback = (message: string) => void;

interface AlignItem {
  text: string;
  start_time: number;
  end_time: number;
}

interface AlignResult {
  text: string;
  items: AlignItem[];
  processing_time: number;
}

/**
 * 從 markdown 中提取純文字（去除圖片、圖說、格式標記）
 */
export function stripMarkdownForTts(markdown: string): string {
  let text = markdown;

  // 移除圖片語法 ![alt](url)
  text = text.replace(/!\[.*?\]\(.*?\)/g, '');

  // 移除圖說（圖片後的斜體行，如 *圖說文字*）
  text = text.replace(/^\s*\*[^*]+\*\s*$/gm, '');

  // 移除 HTML 標籤
  text = text.replace(/<[^>]+>/g, '');

  // 保留連結文字，移除 URL: [text](url) → text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // 移除標題標記 ## → 保留文字
  text = text.replace(/^#{1,6}\s+/gm, '');

  // 移除粗體/斜體標記
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');

  // 移除水平線
  text = text.replace(/^[-*_]{3,}\s*$/gm, '');

  // 壓縮多餘空行
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * 呼叫 TTS clone API（SSE 串流），使用固定參考音頻，回傳 WAV Buffer
 */
async function callTtsClone(text: string, onProgress?: TtsProgressCallback): Promise<{ wav: Buffer; duration: number }> {
  const CHUNK_TIMEOUT_MS = 5 * 60 * 1000; // 5 分鐘無新 chunk 就 abort

  const refAudio = await readFile(REF_AUDIO_PATH);
  const refText = (await readFile(REF_TEXT_PATH, 'utf-8')).trim();

  const formData = new FormData();
  formData.append('text', text);
  formData.append('ref_audio', new Blob([new Uint8Array(refAudio)], { type: 'audio/mpeg' }), 'ref.mp3');
  formData.append('ref_text', refText);

  const controller = new AbortController();
  const response = await fetch(`${TTS_API_BASE}/api/tts/clone`, {
    method: 'POST',
    body: formData,
    signal: controller.signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`TTS Clone API error ${response.status}: ${errText}`);
  }

  if (!response.body) {
    throw new Error('TTS Clone API returned no response body');
  }

  // 串流讀取 SSE
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let audioBase64 = '';
  let duration = 0;
  let timeoutId: ReturnType<typeof setTimeout>;

  const resetTimeout = () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      controller.abort();
    }, CHUNK_TIMEOUT_MS);
  };

  resetTimeout();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      resetTimeout();
      buffer += decoder.decode(value, { stream: true });

      // 逐行解析完整的 SSE event
      const lines = buffer.split('\n');
      buffer = lines.pop()!; // 最後一行可能不完整，留到下次

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event: TtsEvent = JSON.parse(line.slice(6));
          if (event.type === 'status' && event.message) {
            onProgress?.(event.message);
          } else if (event.type === 'queue' && event.message) {
            onProgress?.(event.message);
          } else if (event.type === 'progress' && event.chunks && event.total_chunks) {
            onProgress?.(`生成中... ${event.chunks}/${event.total_chunks} 段`);
          } else if (event.type === 'done' && event.audio) {
            audioBase64 = event.audio;
            duration = event.duration || 0;
          }
        } catch {
          // 跳過無法解析的行（heartbeat 等）
        }
      }
    }
  } finally {
    clearTimeout(timeoutId!);
  }

  if (!audioBase64) {
    throw new Error('TTS Clone API returned no audio data');
  }

  return { wav: Buffer.from(audioBase64, 'base64'), duration };
}

/**
 * WAV → MP3 轉換（使用 ffmpeg）
 */
async function wavToMp3(wavBuffer: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const wavPath = join(tmpdir(), `${id}.wav`);
  const mp3Path = join(tmpdir(), `${id}.mp3`);

  try {
    await writeFile(wavPath, wavBuffer);

    await new Promise<void>((resolve, reject) => {
      execFile('ffmpeg', [
        '-i', wavPath,
        '-codec:a', 'libmp3lame',
        '-qscale:a', '4',
        '-y',
        mp3Path,
      ], (error) => {
        if (error) reject(new Error(`ffmpeg failed: ${error.message}`));
        else resolve();
      });
    });

    return await readFile(mp3Path);
  } finally {
    await unlink(wavPath).catch(() => {});
    await unlink(mp3Path).catch(() => {});
  }
}

/**
 * 呼叫 ASR forced-align API，回傳逐字時間戳
 */
async function callAsrAlign(wavBuffer: Buffer, text: string): Promise<AlignItem[]> {
  const formData = new FormData();
  formData.append('audio', new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' }), 'audio.wav');
  formData.append('text', text);
  formData.append('language', 'auto');

  const response = await fetch(`${TTS_API_BASE}/api/asr/align`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ASR Align API error ${response.status}: ${errText}`);
  }

  const result: AlignResult = await response.json();
  return result.items;
}

/**
 * 原文 + 逐字時間戳 → SRT 字幕格式
 * 用原文的標點符號來分段，再從 align items 取對應時間戳
 */
function itemsToSrt(items: AlignItem[], originalText: string): string {
  const punctuation = /[。，！？；：、…\n]+/;
  const rawSegments = originalText.split(punctuation).filter(s => s.trim());

  let itemIdx = 0;
  const segments: { text: string; start: number; end: number }[] = [];

  for (const seg of rawSegments) {
    const chars = seg.replace(/\s+/g, '');
    if (!chars) continue;

    let start = -1;
    let end = 0;
    let matched = 0;

    for (; itemIdx < items.length && matched < chars.length; itemIdx++) {
      if (start === -1) start = items[itemIdx].start_time;
      end = items[itemIdx].end_time;
      matched++;
    }

    if (start !== -1 && seg.trim()) {
      segments.push({ text: seg.trim(), start, end });
    }
  }

  // 合併太短的段落（< 2 秒且 < 10 字）
  const merged: typeof segments = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (prev && (prev.end - prev.start) < 2 && prev.text.length < 10) {
      prev.text += seg.text;
      prev.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }

  return merged
    .map((seg, i) => {
      const startTs = formatSrtTime(seg.start);
      const endTs = formatSrtTime(seg.end);
      return `${i + 1}\n${startTs} --> ${endTs}\n${seg.text}\n`;
    })
    .join('\n');
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * 為單篇文稿生成語音和字幕，上傳到 Storage
 *
 * 流程：
 * 1. 去除 markdown 格式
 * 2. Clone TTS（使用固定參考音頻，API 自動分段串接）
 * 3. WAV → MP3
 * 4. ASR forced-align → SRT
 * 5. 上傳 MP3 和 SRT 到 Storage
 */
export async function generateArticleAudio(
  weeklyId: number,
  articleId: number,
  markdown: string,
  onProgress?: TtsProgressCallback,
): Promise<{ mp3Url: string; srtUrl: string; duration: number }> {
  // 1. 去除 markdown 格式
  const plainText = stripMarkdownForTts(markdown);
  if (!plainText) {
    throw new Error('Article has no text content for TTS');
  }

  // 2. Clone TTS → WAV
  onProgress?.('語音生成中...');
  const { wav, duration } = await callTtsClone(plainText, onProgress);

  // 3. WAV → MP3
  onProgress?.('轉換音頻格式中...');
  const mp3Buffer = await wavToMp3(wav);

  // 4. ASR forced-align → SRT
  onProgress?.('生成字幕中...');
  const alignItems = await callAsrAlign(wav, plainText);
  const srtContent = itemsToSrt(alignItems, plainText);

  // 5. 上傳到 Storage
  const mp3Path = `articles/${weeklyId}/mp3/${articleId}.mp3`;
  const srtPath = `articles/${weeklyId}/srt/${articleId}.srt`;

  const mp3Url = await uploadToStorage('weekly', mp3Path, mp3Buffer, 'audio/mpeg');
  const srtUrl = await uploadToStorage('weekly', srtPath, srtContent, 'text/plain; charset=utf-8');

  return { mp3Url, srtUrl, duration };
}
