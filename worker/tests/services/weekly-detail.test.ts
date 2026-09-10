import { describe, it, expect } from 'vitest';
import { buildWeeklyDetail, type DetailArticle } from '../../src/services/weekly-detail.js';

function art(over: Partial<DetailArticle> & { id: number; category_id: number }): DetailArticle {
  return {
    title: `T${over.id}`,
    platform: 'digital',
    category: { name: `C${over.category_id}`, sort_order: over.category_id },
    ...over,
  };
}

describe('buildWeeklyDetail', () => {
  const weekly = { week_number: 148, status: 'published' };

  it('groups articles by category and reports counts', () => {
    const articles = [art({ id: 1, category_id: 2 }), art({ id: 2, category_id: 2 }), art({ id: 3, category_id: 1 })];
    const detail = buildWeeklyDetail(weekly, articles);

    expect(detail.article_count).toBe(3);
    expect(detail.week_number).toBe(148);
    expect(detail.status).toBe('published');
    expect(detail.categories).toHaveLength(2);

    const cat1 = detail.categories.find((c) => c.id === 1)!;
    const cat2 = detail.categories.find((c) => c.id === 2)!;
    expect(cat1.article_count).toBe(1);
    expect(cat2.article_count).toBe(2);
  });

  it('orders categories by sort_order', () => {
    const articles = [
      { id: 1, category_id: 3, category: { name: 'third', sort_order: 30 } },
      { id: 2, category_id: 1, category: { name: 'first', sort_order: 10 } },
      { id: 3, category_id: 2, category: { name: 'second', sort_order: 20 } },
    ];
    const detail = buildWeeklyDetail(weekly, articles);
    expect(detail.categories.map((c) => c.name)).toEqual(['first', 'second', 'third']);
  });

  it('strips the nested category object from each article', () => {
    const detail = buildWeeklyDetail(weekly, [art({ id: 1, category_id: 1 })]);
    const first = detail.categories[0].articles[0];
    expect(first).not.toHaveProperty('category');
    expect(first).toMatchObject({ id: 1, title: 'T1', platform: 'digital' });
  });

  it('falls back to 未分類 / sort_order 0 when category info is missing', () => {
    const detail = buildWeeklyDetail(weekly, [{ id: 1, category_id: 9, category: null }]);
    expect(detail.categories[0].name).toBe('未分類');
    expect(detail.categories[0].sort_order).toBe(0);
  });

  it('returns an empty categories list for a weekly with no articles', () => {
    const detail = buildWeeklyDetail(weekly, []);
    expect(detail.article_count).toBe(0);
    expect(detail.categories).toEqual([]);
  });
});
