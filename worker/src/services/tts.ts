import { execFile } from 'child_process';
import { writeFile, unlink, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { uploadToStorage } from './supabase.js';

const TTS_API_BASE = process.env.TTS_API_URL || 'https://tcm1.tzuchi-org.tw';
const TTS_INSTRUCT = '一名資深Podcaster 知性成熟的男低声，语速适中';
const SENTENCE_GAP = 0.3; // 句子間停頓秒數

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
 * 以「。」為單位分割文字為句組
 * 每個句組 = 從上一個「。」到下一個「。」的完整內容
 */
function splitBySentence(text: string): string[] {
  // 以「。」切割，保留每段末尾的句號上下文
  const raw = text.split(/(?<=。)/);
  const sentences: string[] = [];

  for (const part of raw) {
    const trimmed = part.trim();
    if (trimmed) sentences.push(trimmed);
  }

  // 如果最後一段沒有「。」結尾，也納入
  return sentences.length > 0 ? sentences : [text];
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
 * 用 ffmpeg 執行指令
 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, (error) => {
      if (error) reject(new Error(`ffmpeg failed: ${error.message}`));
      else resolve();
    });
  });
}

/**
 * 生成指定秒數的靜音 WAV
 */
async function generateSilenceWav(seconds: number, sampleRate: number): Promise<string> {
  const path = join(tmpdir(), `silence_${randomUUID()}.wav`);
  await runFfmpeg([
    '-f', 'lavfi',
    '-i', `anullsrc=r=${sampleRate}:cl=mono`,
    '-t', String(seconds),
    '-codec:a', 'pcm_s16le',
    '-y', path,
  ]);
  return path;
}

/**
 * 用 ffmpeg concat 多個 WAV 檔（含句間停頓），輸出合併 WAV
 */
async function concatWavFiles(wavPaths: string[], silencePath: string): Promise<string> {
  const id = randomUUID();
  const listPath = join(tmpdir(), `concat_${id}.txt`);
  const outputPath = join(tmpdir(), `combined_${id}.wav`);

  // 建立 ffmpeg concat list：wav1 + silence + wav2 + silence + ...
  const lines: string[] = [];
  for (let i = 0; i < wavPaths.length; i++) {
    lines.push(`file '${wavPaths[i]}'`);
    if (i < wavPaths.length - 1) {
      lines.push(`file '${silencePath}'`);
    }
  }
  await writeFile(listPath, lines.join('\n'));

  await runFfmpeg([
    '-f', 'concat', '-safe', '0',
    '-i', listPath,
    '-codec:a', 'pcm_s16le',
    '-y', outputPath,
  ]);

  await unlink(listPath).catch(() => {});
  return outputPath;
}

/**
 * WAV → MP3 轉換
 */
async function wavToMp3(wavPath: string): Promise<Buffer> {
  const mp3Path = wavPath.replace(/\.wav$/, '.mp3');
  await runFfmpeg([
    '-i', wavPath,
    '-codec:a', 'libmp3lame',
    '-qscale:a', '4',  // ~165 kbps VBR
    '-y', mp3Path,
  ]);
  const buf = await readFile(mp3Path);
  await unlink(mp3Path).catch(() => {});
  return buf;
}

/**
 * 呼叫 ASR forced-align API，回傳逐字時間戳
 */
async function callAsrAlign(wavPath: string, text: string): Promise<AlignItem[]> {
  const wavBuffer = await readFile(wavPath);

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

  // 3. 合併太短的段落（< 2 秒且 < 10 字）
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
 * 2. 以「。」為單位分句
 * 3. 逐句呼叫 TTS 生成 WAV
 * 4. ffmpeg 串接所有 WAV（句間 0.3s 停頓）
 * 5. 合併後 WAV → MP3
 * 6. 合併後 WAV + 原文 → ASR forced-align → SRT
 * 7. 上傳 MP3 和 SRT 到 Storage
 */
export async function generateArticleAudio(
  weeklyId: number,
  articleId: number,
  markdown: string,
): Promise<{ mp3Url: string; srtUrl: string; duration: number }> {
  const tempFiles: string[] = [];

  try {
    // 1. 去除 markdown 格式
    const plainText = stripMarkdownForTts(markdown);
    if (!plainText) {
      throw new Error('Article has no text content for TTS');
    }

    // 2. 以「。」分句
    const sentences = splitBySentence(plainText);
    console.log(`[tts] Article ${articleId}: ${sentences.length} sentences`);

    // 3. 逐句 TTS → WAV 檔案
    const wavPaths: string[] = [];
    let sampleRate = 24000;

    for (let i = 0; i < sentences.length; i++) {
      const { wav, duration } = await callTtsVoiceDesign(sentences[i]);
      const wavPath = join(tmpdir(), `tts_${articleId}_${i}_${randomUUID()}.wav`);
      await writeFile(wavPath, wav);
      wavPaths.push(wavPath);
      tempFiles.push(wavPath);
      console.log(`[tts] Sentence ${i + 1}/${sentences.length}: ${duration.toFixed(1)}s`);
    }

    // 4. 生成靜音片段 + 串接
    const silencePath = await generateSilenceWav(SENTENCE_GAP, sampleRate);
    tempFiles.push(silencePath);

    const combinedWavPath = await concatWavFiles(wavPaths, silencePath);
    tempFiles.push(combinedWavPath);

    // 5. 合併 WAV → MP3
    const mp3Buffer = await wavToMp3(combinedWavPath);

    // 6. ASR forced-align（合併後 WAV + 原文） → SRT
    const alignItems = await callAsrAlign(combinedWavPath, plainText);
    const srtContent = itemsToSrt(alignItems, plainText);

    // 計算總時長
    const combinedWav = await readFile(combinedWavPath);
    const totalDuration = (combinedWav.length - 44) / (sampleRate * 2); // 16-bit mono

    // 7. 上傳到 Storage
    const mp3Path = `articles/${weeklyId}/mp3/${articleId}.mp3`;
    const srtPath = `articles/${weeklyId}/srt/${articleId}.srt`;

    const mp3Url = await uploadToStorage('weekly', mp3Path, mp3Buffer, 'audio/mpeg');
    const srtUrl = await uploadToStorage('weekly', srtPath, srtContent, 'text/srt');

    return { mp3Url, srtUrl, duration: totalDuration };
  } finally {
    // 清理所有暫存檔
    for (const f of tempFiles) {
      await unlink(f).catch(() => {});
    }
  }
}
