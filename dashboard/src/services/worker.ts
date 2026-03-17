import type { ImportRequest, RewriteRequest, ApiError } from '../types/index.js';
import { authStore } from '../stores/auth-store.js';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '/worker';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

async function fetchWorker<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    ...(options.headers as Record<string, string>),
  };

  // Attach auth token for authenticated requests
  const token = authStore.session?.access_token;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${WORKER_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error: ApiError = await response.json().catch(() => ({
      error: 'UNKNOWN_ERROR',
      message: `Request failed with status ${response.status}`,
    }));
    throw new Error(error.message);
  }

  return response.json();
}

export interface ImportResponse {
  success: boolean;
  weekly_id: number;
  message?: string;
}

export async function startImport(request: ImportRequest): Promise<ImportResponse> {
  return fetchWorker<ImportResponse>('/import', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export interface RewriteResponse {
  success: boolean;
  article_id: number;
  message?: string;
}

export async function rewriteArticle(request: RewriteRequest): Promise<RewriteResponse> {
  return fetchWorker<RewriteResponse>('/rewrite', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
}

export async function checkWorkerHealth(): Promise<HealthResponse> {
  return fetchWorker<HealthResponse>('/health', {
    method: 'GET',
  });
}

export function extractDocId(url: string): string | null {
  // Validate domain
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('google.com')) {
      return null;
    }
  } catch {
    return null;
  }

  // Handle various Google Docs URL formats
  const patterns = [
    /\/document\/d\/([a-zA-Z0-9_-]+)/,
    /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

export function isValidDocUrl(url: string): boolean {
  return extractDocId(url) !== null;
}

export interface ClaudeStatusResponse {
  authenticated: boolean;
  message: string;
  detail?: string;
}

export async function checkClaudeStatus(): Promise<ClaudeStatusResponse> {
  return fetchWorker<ClaudeStatusResponse>('/claude/status', {
    method: 'GET',
  });
}


export interface PushNotificationRequest {
  title: string;
  body: string;
  url?: string;
  source?: 'custom' | 'weekly_publish' | 'article';
}

export interface PushNotificationResponse {
  sent: number;
  failed: number;
}

export async function sendPushNotification(
  request: PushNotificationRequest
): Promise<PushNotificationResponse> {
  // 走公開 API 路由（/api/v1/*），不走 /worker/*（需 Kong API key）
  // Worker 的 requireAuth 仍會驗證 Supabase token
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = authStore.session?.access_token;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch('/api/v1/push/send', {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('推播頻率超過限制，請稍後再試');
    }
    const error = await response.json().catch(() => ({
      message: `Request failed with status ${response.status}`,
    }));
    throw new Error(error.message);
  }

  return response.json();
}

export interface PushLogEntry {
  id: number;
  user_email: string | null;
  metadata: {
    title: string;
    body: string;
    url?: string;
    sent: number;
    failed: number;
    source: string;
  };
  created_at: string;
}

export interface PushLogsResponse {
  data: PushLogEntry[];
  total: number;
  page: number;
  page_count: number;
  limit: number;
  offset: number;
}

export async function fetchPushLogs(
  limit = 20,
  offset = 0,
  source?: string
): Promise<PushLogsResponse> {
  const headers: Record<string, string> = {};
  const token = authStore.session?.access_token;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (source) {
    params.set('source', source);
  }

  const response = await fetch(`/api/v1/push/logs?${params}`, { headers });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      message: `Request failed with status ${response.status}`,
    }));
    throw new Error(error.message);
  }

  return response.json();
}
