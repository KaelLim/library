import type { FastifyRequest, FastifyReply } from 'fastify';
import { getSupabase } from '../services/supabase.js';

type CachedAuth = {
  email: string;
  isActive: boolean;
  expiresAt: number;
};

const TOKEN_CACHE_TTL_MS = 30_000;
const SUPABASE_TIMEOUT_MS = 5_000;
const tokenCache = new Map<string, CachedAuth>();

function getCached(token: string): CachedAuth | null {
  const hit = tokenCache.get(token);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    tokenCache.delete(token);
    return null;
  }
  return hit;
}

function setCached(token: string, email: string, isActive: boolean) {
  tokenCache.set(token, { email, isActive, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
  // LRU 上限：避免 token 快取無限成長
  if (tokenCache.size > 1000) {
    const first = tokenCache.keys().next().value;
    if (first) tokenCache.delete(first);
  }
}

async function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms),
    ),
  ]);
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);

  const cached = getCached(token);
  if (cached) {
    if (!cached.isActive) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'User not authorized' });
    }
    (request as any).user = { email: cached.email };
    return;
  }

  const supabase = getSupabase();

  let user: { email?: string | null } | null;
  try {
    const { data, error } = await withTimeout(
      supabase.auth.getUser(token),
      SUPABASE_TIMEOUT_MS,
      'auth.getUser',
    );
    if (error || !data.user) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or expired token' });
    }
    user = data.user;
  } catch {
    return reply.status(503).send({ error: 'AUTH_UNAVAILABLE', message: 'Auth service unavailable' });
  }

  if (!user?.email) {
    return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Token has no email claim' });
  }

  let allowed: { is_active: boolean | null } | null;
  try {
    const { data } = await withTimeout(
      supabase.from('allowed_users').select('is_active').eq('email', user.email).single(),
      SUPABASE_TIMEOUT_MS,
      'allowed_users.select',
    );
    allowed = data;
  } catch {
    return reply.status(503).send({ error: 'AUTH_UNAVAILABLE', message: 'Auth service unavailable' });
  }

  const isActive = allowed?.is_active === true;
  setCached(token, user.email, isActive);

  if (!isActive) {
    return reply.status(403).send({ error: 'FORBIDDEN', message: 'User not authorized' });
  }

  (request as any).user = { email: user.email };
}
