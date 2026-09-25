/**
 * Google Drive Service Account auth
 *
 * 金鑰來源（依序優先）：
 *   1. GOOGLE_SERVICE_ACCOUNT_FILE — 掛載進來的 JSON 檔路徑（生產環境建議）
 *   2. GOOGLE_SERVICE_ACCOUNT_JSON — 整串 JSON 字串
 * 取得後用 RS256 JWT bearer flow 換 OAuth access token，
 * 內建 memory cache + auto refresh（過期前 5 分鐘 refresh）。
 *
 * 兩者都未設或解析失敗 → 回 null，由 caller fallback 到 user OAuth token。
 */

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 分鐘

let cachedKey: ServiceAccountKey | null | undefined;
let cachedToken: CachedToken | null = null;
let inflight: Promise<string> | null = null;

/**
 * 取得 SA 金鑰的原始 JSON 字串。
 * 優先讀 GOOGLE_SERVICE_ACCOUNT_FILE（掛載檔），否則讀 GOOGLE_SERVICE_ACCOUNT_JSON（env 字串）。
 * 兩者皆無、或檔案讀不到 → 回 null。
 */
export function readRawServiceAccountKey(): string | null {
  const filePath = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (filePath) {
    try {
      return readFileSync(filePath, 'utf-8');
    } catch (err) {
      console.warn(`[drive-auth] Failed to read GOOGLE_SERVICE_ACCOUNT_FILE (${filePath}):`, err);
      return null;
    }
  }
  return process.env.GOOGLE_SERVICE_ACCOUNT_JSON || null;
}

/**
 * 解析 SA 金鑰 JSON 字串為 key 物件。
 * 非法 JSON、缺 client_email 或 private_key → 回 null。
 */
export function parseServiceAccountKey(raw: string | null): ServiceAccountKey | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccountKey;
    if (!parsed.client_email || !parsed.private_key) {
      console.warn('[drive-auth] service account key missing client_email or private_key');
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn('[drive-auth] Failed to parse service account key:', err);
    return null;
  }
}

function loadKey(): ServiceAccountKey | null {
  if (cachedKey !== undefined) return cachedKey;
  cachedKey = parseServiceAccountKey(readRawServiceAccountKey());
  return cachedKey;
}

export function isServiceAccountConfigured(): boolean {
  return loadKey() !== null;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(key: ServiceAccountKey): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: key.client_email,
    scope: SCOPE,
    aud: key.token_uri || TOKEN_URI,
    iat: now,
    exp: now + 3600,
  };

  const segments = [
    base64UrlEncode(JSON.stringify(header)),
    base64UrlEncode(JSON.stringify(claims)),
  ];
  const unsigned = segments.join('.');

  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(key.private_key);

  return `${unsigned}.${base64UrlEncode(signature)}`;
}

async function exchangeJwtForToken(jwt: string, key: ServiceAccountKey): Promise<CachedToken> {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });

  const resp = await fetch(key.token_uri || TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Service account token exchange failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * 取得 Drive API access token。
 * SA 未設定 → 回 null（caller 應回報「Service Account 未設定」）。
 * 設定但取 token 失敗 → throw Error。
 */
export async function getServiceAccessToken(): Promise<string | null> {
  const key = loadKey();
  if (!key) return null;

  if (cachedToken && cachedToken.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
    return cachedToken.accessToken;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const jwt = signJwt(key);
      cachedToken = await exchangeJwtForToken(jwt, key);
      return cachedToken.accessToken;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
