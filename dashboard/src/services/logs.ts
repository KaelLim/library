import { supabase } from './supabase.js';
import type { AuditLog, AuditAction } from '../types/database.js';

export interface LogsFilter {
  action?: AuditAction;
  days?: number;
  limit?: number;
  offset?: number;
}

export interface LogsStats {
  todayCount: number;
  lastImport: { weeklyId: number; time: string } | null;
  lastError: { message: string; time: string } | null;
}

/**
 * 取得日誌列表（分頁 + 篩選）
 */
export async function getAuditLogs(filter: LogsFilter = {}): Promise<AuditLog[]> {
  const { action, days, limit = 50, offset = 0 } = filter;

  let query = supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false });

  if (action) {
    query = query.eq('action', action);
  }

  if (days) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte('created_at', since.toISOString());
  }

  query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * 取得統計摘要
 */
export async function getLogsStats(): Promise<LogsStats> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [todayResult, lastImportResult, lastErrorResult] = await Promise.all([
    // 今日操作數
    supabase
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString()),

    // 最近成功匯入
    supabase
      .from('audit_logs')
      .select('*')
      .eq('action', 'import')
      .eq('metadata->>step', 'completed')
      .order('created_at', { ascending: false })
      .limit(1),

    // 最近匯入失敗
    supabase
      .from('audit_logs')
      .select('*')
      .eq('action', 'import')
      .eq('metadata->>step', 'failed')
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  if (todayResult.error) throw todayResult.error;
  if (lastImportResult.error) throw lastImportResult.error;
  if (lastErrorResult.error) throw lastErrorResult.error;

  const lastImport = lastImportResult.data?.[0];
  const lastError = lastErrorResult.data?.[0];

  return {
    todayCount: todayResult.count ?? 0,
    lastImport: lastImport
      ? {
          weeklyId: lastImport.record_id ?? (lastImport.metadata as Record<string, unknown>)?.weekly_id as number ?? 0,
          time: lastImport.created_at,
        }
      : null,
    lastError: lastError
      ? {
          message: ((lastError.metadata as Record<string, unknown>)?.error as string) || '未知錯誤',
          time: lastError.created_at,
        }
      : null,
  };
}

/**
 * 取得各 action 的 count（用於 tabs）
 */
export async function getActionCounts(days?: number): Promise<Record<string, number>> {
  let query = supabase
    .from('audit_logs')
    .select('action');

  if (days) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte('created_at', since.toISOString());
  }

  const { data, error } = await query;
  if (error) throw error;

  const counts: Record<string, number> = {};
  let total = 0;
  for (const row of data || []) {
    counts[row.action] = (counts[row.action] || 0) + 1;
    total++;
  }
  counts['all'] = total;
  return counts;
}
