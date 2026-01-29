import type { ImportRequest, RewriteRequest, ApiError } from '../types/index.js';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || '/worker';

async function fetchWorker<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${WORKER_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
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
  // Handle various Google Docs URL formats
  // https://docs.google.com/document/d/DOC_ID/edit
  // https://docs.google.com/document/d/DOC_ID/
  // https://docs.google.com/document/d/DOC_ID
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
