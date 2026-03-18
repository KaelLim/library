import { execFile } from 'child_process';
import { writeFile, unlink, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { uploadToStorage } from './supabase.js';

const TTS_API_BASE = process.env.TTS_API_URL || 'https://tcm1.tzuchi-org.tw';
const TTS_INSTRUCT = '一名資深Podcaster 知性成熟的男低声，语速适中';

interface TtsEvent {
  type: 'status' | 'progress' | 'done';
  message?: string;
  audio?: string; // base64 WAV
  sample_rate?: number;
  duration?: number;
  elapsed?: number;
  chunks?: number;
}

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
 * 呼叫 TTS voice-design API（SSE 串流），回傳 WAV Buffer
 */
async function callTtsVoiceDesign(text: string): Promise<{ wav: Buffer; duration: number }> {
  const formData = new FormData();
  formData.append('text', text);
  formData.append('instruct', TTS_INSTRUCT);

  const response = await fetch(`${TTS_API_BASE}/api/tts/voice-design`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`TTS API error ${response.status}: ${errText}`);
  }

  // 解析 SSE 串流
  const body = await response.text();
  const lines = body.split('\n');

  let audioBase64 = '';
  let duration = 0;

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const event: TtsEvent = JSON.parse(line.slice(6));
    if (event.type === 'done' && event.audio) {
      audioBase64 = event.audio;
      duration = event.duration || 0;
    }
  }

  if (!audioBase64) {
    throw new Error('TTS API returned no audio data');
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
        '-qscale:a', '4',  // ~165 kbps VBR
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
  formData.append('language', 'Chinese');

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
  // 1. 用標點分割原文為句段
  const punctuation = /[。，！？；：、…\n]+/;
  const rawSegments = originalText.split(punctuation).filter(s => s.trim());

  // 2. 建立 align items 的字元 → 時間對照表
  let itemIdx = 0;
  const segments: { text: string; start: number; end: number }[] = [];

  for (const seg of rawSegments) {
    // 去除空白取得純字元
    const chars = seg.replace(/\s+/g, '');
    if (!chars) continue;

    let start = -1;
    let end = 0;
    let matched = 0;

    // 從 items 中匹配此段的字元
    for (; itemIdx < items.length && matched < chars.length; itemIdx++) {
      if (start === -1) start = items[itemIdx].start_time;
      end = items[itemIdx].end_time;
      matched++;
    }

    if (start !== -1 && seg.trim()) {
      segments.push({ text: seg.trim(), start, end });
    }
  }

  // 3. 合併太短的段落（< 2 秒且 < 10 字），拆分太長的段落（> 30 字）
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
 */
export async function generateArticleAudio(
  weeklyId: number,
  articleId: number,
  markdown: string,
): Promise<{ mp3Url: string; srtUrl: string; duration: number }> {
  // 1. 去除 markdown 格式，取得純文字
  const plainText = stripMarkdownForTts(markdown);
  if (!plainText) {
    throw new Error('Article has no text content for TTS');
  }

  // 2. TTS 生成 WAV
  const { wav, duration } = await callTtsVoiceDesign(plainText);

  // 3. WAV → MP3
  const mp3Buffer = await wavToMp3(wav);

  // 4. ASR 對齊生成時間戳
  const alignItems = await callAsrAlign(wav, plainText);

  // 5. 時間戳 → SRT
  const srtContent = itemsToSrt(alignItems, plainText);

  // 6. 上傳到 Storage
  const mp3Path = `articles/${weeklyId}/mp3/${articleId}.mp3`;
  const srtPath = `articles/${weeklyId}/srt/${articleId}.srt`;

  const mp3Url = await uploadToStorage('weekly', mp3Path, mp3Buffer, 'audio/mpeg');
  const srtUrl = await uploadToStorage('weekly', srtPath, srtContent, 'text/srt');

  return { mp3Url, srtUrl, duration };
}
