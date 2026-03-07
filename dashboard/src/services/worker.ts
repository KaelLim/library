import type { ImportRequest, RewriteRequest, ApiError } from '../types/index.js';
import { authStore } from '../stores/auth-store.js';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '/worker';

async function fetchWorker<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
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

export interface PushNotificationRequest {
  title: string;
  body: string;
  url?: string;
}

export interface PushNotificationResponse {
  sent: number;
  failed: number;
}

export async function sendPushNotification(
  request: PushNotificationRequest
): Promise<PushNotificationResponse> {
  return fetchWorker<PushNotificationResponse>('/api/v1/push/send', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}
