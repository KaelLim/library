import type { FastifyRequest, FastifyReply } from 'fastify';
import { getSupabase } from '../services/supabase.js';

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);
  const supabase = getSupabase();

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or expired token' });
  }

  const { data: allowed } = await supabase
    .from('allowed_users')
    .select('is_active')
    .eq('email', user.email)
    .single();

  if (!allowed?.is_active) {
    return reply.status(403).send({ error: 'FORBIDDEN', message: 'User not authorized' });
  }
}
