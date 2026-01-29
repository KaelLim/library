import { supabase } from './supabase.js';
import type { Weekly, WeeklyStatus } from '../types/index.js';

export interface WeeklyWithCount extends Weekly {
  article_count?: number;
}

export async function getWeeklyList(status?: WeeklyStatus): Promise<WeeklyWithCount[]> {
  let query = supabase
    .from('weekly')
    .select('*')
    .order('week_number', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching weekly list:', error);
    throw new Error(error.message);
  }

  // Get article counts for each weekly
  const weekNumbers = data?.map((w) => w.week_number) || [];
  if (weekNumbers.length > 0) {
    const { data: counts, error: countError } = await supabase
      .from('articles')
      .select('weekly_id')
      .in('weekly_id', weekNumbers)
      .eq('platform', 'docs');

    if (!countError && counts) {
      const countMap = new Map<number, number>();
      for (const item of counts) {
        const current = countMap.get(item.weekly_id) || 0;
        countMap.set(item.weekly_id, current + 1);
      }

      return (data || []).map((w) => ({
        ...w,
        article_count: countMap.get(w.week_number) || 0,
      }));
    }
  }

  return data || [];
}

export async function getWeekly(weekNumber: number): Promise<Weekly | null> {
  const { data, error } = await supabase
    .from('weekly')
    .select('*')
    .eq('week_number', weekNumber)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('Error fetching weekly:', error);
    throw new Error(error.message);
  }

  return data;
}

export async function updateWeeklyStatus(
  weekNumber: number,
  status: WeeklyStatus,
  publishDate?: string
): Promise<Weekly> {
  const updateData: Partial<Weekly> = { status };
  if (publishDate !== undefined) {
    updateData.publish_date = publishDate;
  }

  const { data, error } = await supabase
    .from('weekly')
    .update(updateData)
    .eq('week_number', weekNumber)
    .select()
    .single();

  if (error) {
    console.error('Error updating weekly status:', error);
    throw new Error(error.message);
  }

  return data;
}

export async function deleteWeekly(weekNumber: number): Promise<void> {
  const { error } = await supabase
    .from('weekly')
    .delete()
    .eq('week_number', weekNumber);

  if (error) {
    console.error('Error deleting weekly:', error);
    throw new Error(error.message);
  }
}

export async function getNextWeekNumber(): Promise<number> {
  const { data, error } = await supabase
    .from('weekly')
    .select('week_number')
    .order('week_number', { ascending: false })
    .limit(1);

  if (error) {
    console.error('Error getting next week number:', error);
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    return 1;
  }

  return data[0].week_number + 1;
}
