/**
 * Google Drive Service Account auth
 *
 * 讀取 GOOGLE_SERVICE_ACCOUNT_JSON env（整串 JSON 字串），
 * 用 RS256 JWT bearer flow 換 OAuth access token，
 * 內建 memory cache + auto refresh（過期前 5 分鐘 refresh）。
 *
 * env 未設或解析失敗 → 回 null，由 caller fallback 到 user OAuth token。
 */

import { createSign } from 'node:crypto';

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

function loadKey(): ServiceAccountKey | null {
  if (cachedKey !== undefined) return cachedKey;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    cachedKey = null;
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ServiceAccountKey;
    if (!parsed.client_email || !parsed.private_key) {
      console.warn('[drive-auth] GOOGLE_SERVICE_ACCOUNT_JSON missing client_email or private_key');
      cachedKey = null;
      return null;
    }
    cachedKey = parsed;
    return cachedKey;
  } catch (err) {
    console.warn('[drive-auth] Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', err);
    cachedKey = null;
    return null;
  }
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
 * env 未設 → 回 null（caller 應 fallback 至 user provider_token）。
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
