// Pure timeout policy for runSessionWithStreaming. No I/O.
//
// 背景：舊版只有單一 2 分鐘 IDLE_TIMEOUT，且檢查寫在 for-await 迴圈內、在
// lastActivityTime 重設之前，因此它同時把「等第一個 token 的時間」也卡在 2 分鐘。
// Opus 冷啟動 + 整份週報 markdown 的 prefill 常逼近/超過 2 分鐘，導致一次正常但較慢
// 的查詢被誤殺（false positive）。這裡把逾時拆成兩段預算：
//   - 首個內容 token 之前：較寬鬆的 firstTokenTimeoutMs（預設 5 分鐘）
//   - 首個內容 token 之後：較緊的 idleTimeoutMs（預設 2 分鐘，維持原本語意）
// 注意「首個內容 token」指第一個 text_delta，而非 SDK 立刻送出的 init 訊息。

export interface TimeoutConfig {
  firstTokenTimeoutMs: number;
  idleTimeoutMs: number;
}

export const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 10 * 60 * 1000; // 首個 token 預算（10 分鐘；opus 語義判讀 + thinking 較久）
export const DEFAULT_IDLE_TIMEOUT_MS = 2 * 60 * 1000; // 中途閒置上限

/**
 * 依「是否已收到首個內容 token」選用對應預算，判斷是否逾時。
 * @returns 逾時時回傳錯誤訊息字串；未逾時回傳 null。
 */
export function checkAiTimeout(
  now: number,
  lastActivityTime: number,
  sawFirstContent: boolean,
  config: TimeoutConfig
): string | null {
  const elapsed = now - lastActivityTime;
  if (sawFirstContent) {
    if (elapsed > config.idleTimeoutMs) {
      return `AI query idle timeout: no response for ${minutes(config.idleTimeoutMs)} minutes`;
    }
  } else if (elapsed > config.firstTokenTimeoutMs) {
    return `AI query first-token timeout: no first token within ${minutes(config.firstTokenTimeoutMs)} minutes`;
  }
  return null;
}

/** 從環境變數解析逾時設定；無效/非正數一律退回預設。 */
export function resolveTimeoutConfig(env: {
  AI_FIRST_TOKEN_TIMEOUT_MS?: string;
  AI_IDLE_TIMEOUT_MS?: string;
}): TimeoutConfig {
  return {
    firstTokenTimeoutMs: positiveIntOr(env.AI_FIRST_TOKEN_TIMEOUT_MS, DEFAULT_FIRST_TOKEN_TIMEOUT_MS),
    idleTimeoutMs: positiveIntOr(env.AI_IDLE_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS),
  };
}

function positiveIntOr(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function minutes(ms: number): number {
  return Math.round(ms / 60000);
}
