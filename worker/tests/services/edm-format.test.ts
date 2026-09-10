import { describe, it, expect } from 'vitest';
import {
  extractImagesFromMarkdown,
  extractFirstImage,
  pickFirstArticlePerCategory,
  formatEdmDate,
  buildEdmPayload,
  type EdmArticle,
  type EdmUrlHelpers,
} from '../../src/services/edm-format.js';

// 測試用的 URL helper：toPublicUrl 加前綴以便斷言相對路徑有被轉換。
const helpers: EdmUrlHelpers = {
  frontendUrl: 'https://weekly.example',
  toPublicUrl: (path) => (path ? (path.startsWith('http') ? path : `https://cdn.example/${path}`) : null),
};

function article(over: Partial<EdmArticle> & { id: number; category_id: number }): EdmArticle {
  return {
    title: `T${over.id}`,
    description: `D${over.id}`,
    content: `![img](pic${over.id}.jpg)`,
    category: { name: `C${over.category_id}` },
    ...over,
  };
}

describe('extractImagesFromMarkdown', () => {
  it('extracts all markdown image URLs in order', () => {
    expect(extractImagesFromMarkdown('a ![x](one.jpg) b ![y](two.png)')).toEqual(['one.jpg', 'two.png']);
  });
  it('returns [] for empty/no images', () => {
    expect(extractImagesFromMarkdown('')).toEqual([]);
    expect(extractImagesFromMarkdown('no images here')).toEqual([]);
  });
});

describe('extractFirstImage', () => {
  it('prefers the first markdown image', () => {
    expect(extractFirstImage('![a](md.jpg) <img src="html.jpg">')).toBe('md.jpg');
  });
  it('falls back to HTML <img> when no markdown image', () => {
    expect(extractFirstImage('text <img alt="x" src="html.jpg"> more')).toBe('html.jpg');
  });
  it('returns "" for null/empty/no image', () => {
    expect(extractFirstImage(null)).toBe('');
    expect(extractFirstImage(undefined)).toBe('');
    expect(extractFirstImage('just words')).toBe('');
  });
});

describe('pickFirstArticlePerCategory', () => {
  it('keeps the smallest id per category regardless of input order', () => {
    const map = pickFirstArticlePerCategory([
      { id: 30, category_id: 1 },
      { id: 10, category_id: 1 },
      { id: 20, category_id: 2 },
    ]);
    expect(map.get(1)!.id).toBe(10);
    expect(map.get(2)!.id).toBe(20);
    expect(map.size).toBe(2);
  });
});

describe('formatEdmDate', () => {
  it('formats display date without zero-padding and yyyymmdd with padding', () => {
    expect(formatEdmDate('2026-05-09')).toEqual({ titleDate: '2026年5月9日', yyyymmdd: '20260509' });
    expect(formatEdmDate('2026-11-19')).toEqual({ titleDate: '2026年11月19日', yyyymmdd: '20261119' });
  });
});

describe('buildEdmPayload — header fields', () => {
  const weekly = { week_number: 148, publish_date: '2026-05-19' };
  const payload = buildEdmPayload(weekly, [article({ id: 1, category_id: 1 })], helpers);

  it('sets title_num as the numeric week_number', () => {
    expect(payload.title_num).toBe(148);
  });
  it('sets title_date and title_link with the homepage UTM campaign', () => {
    expect(payload.title_date).toBe('2026年5月19日');
    expect(payload.title_link).toBe(
      'https://weekly.example/?utm_source=aq_edm&utm_medium=email&utm_campaign=weekly-148-20260519'
    );
  });
});

describe('buildEdmPayload — section N maps to category_id N (the bug fix)', () => {
  const weekly = { week_number: 148, publish_date: '2026-05-19' };

  it('REGRESSION: a missing middle category does NOT shift later ones up', () => {
    // category 5 缺席，其餘 1-4,6-8 都有文章
    const articles = [1, 2, 3, 4, 6, 7, 8].map((cid) => article({ id: cid * 10, category_id: cid }));
    const payload = buildEdmPayload(weekly, articles, helpers);

    // section5 必須保持空（category 5 沒文章）
    expect(payload.section5_pic).toBe('');
    expect(payload.section5_title).toBe('');
    expect(payload.section5_text).toBe('');
    expect(payload.section5_link).toBe('');

    // section6 必須是 category 6 的文章（id=60），而不是被 category 6 遞補的舊 bug
    expect(payload.section6_title).toBe('T60');
    expect(payload.section6_text).toBe('D60');
    expect(payload.section6_link).toContain('/article/60/');
    expect(payload.section6_link).toContain('utm_content=60-C6');

    // section7 = category 7、section8 = category 8（沒有位移、沒有尾端消失）
    expect(payload.section7_title).toBe('T70');
    expect(payload.section8_title).toBe('T80');
  });

  it('always emits all 8 section slots (fixed positions)', () => {
    const payload = buildEdmPayload(weekly, [article({ id: 10, category_id: 1 })], helpers);
    for (let n = 1; n <= 8; n++) {
      expect(payload).toHaveProperty(`section${n}_pic`);
      expect(payload).toHaveProperty(`section${n}_title`);
      expect(payload).toHaveProperty(`section${n}_text`);
      expect(payload).toHaveProperty(`section${n}_link`);
    }
    // 只有 category 1 有文章：其餘全空
    expect(payload.section1_title).toBe('T10');
    expect(payload.section2_title).toBe('');
    expect(payload.section8_title).toBe('');
  });

  it('maps every category 1:1 when all are present', () => {
    const articles = [1, 2, 3, 4, 5, 6, 7, 8].map((cid) => article({ id: cid, category_id: cid }));
    const payload = buildEdmPayload(weekly, articles, helpers);
    for (let cid = 1; cid <= 8; cid++) {
      expect(payload[`section${cid}_title`]).toBe(`T${cid}`);
      expect(payload[`section${cid}_link`]).toContain(`/article/${cid}/`);
    }
  });
});

describe('buildEdmPayload — image and field handling', () => {
  const weekly = { week_number: 100, publish_date: '2026-01-01' };

  it('converts a relative image path to a public URL', () => {
    const payload = buildEdmPayload(weekly, [article({ id: 1, category_id: 1, content: '![a](weekly/x.jpg)' })], helpers);
    expect(payload.section1_pic).toBe('https://cdn.example/weekly/x.jpg');
  });

  it('leaves an absolute image URL untouched', () => {
    const payload = buildEdmPayload(
      weekly,
      [article({ id: 1, category_id: 1, content: '![a](https://img.example/x.jpg)' })],
      helpers
    );
    expect(payload.section1_pic).toBe('https://img.example/x.jpg');
  });

  it('emits "" for pic when the article has no image', () => {
    const payload = buildEdmPayload(weekly, [article({ id: 1, category_id: 1, content: 'no image' })], helpers);
    expect(payload.section1_pic).toBe('');
  });

  it('reads category name whether it is an object or a PostgREST array', () => {
    const objShape = buildEdmPayload(weekly, [{ id: 5, category_id: 1, content: '', category: { name: 'Obj' } }], helpers);
    expect(objShape.section1_link).toContain('utm_content=5-Obj');

    const arrShape = buildEdmPayload(weekly, [{ id: 6, category_id: 1, content: '', category: [{ name: 'Arr' }] }], helpers);
    expect(arrShape.section1_link).toContain('utm_content=6-Arr');
  });

  it('falls back to empty strings for null title/description', () => {
    const payload = buildEdmPayload(
      weekly,
      [article({ id: 1, category_id: 1, title: null, description: null })],
      helpers
    );
    expect(payload.section1_title).toBe('');
    expect(payload.section1_text).toBe('');
  });
});

describe('buildEdmPayload — maxCategory override', () => {
  it('honours a smaller maxCategory (e.g. for tests / future category counts)', () => {
    const weekly = { week_number: 1, publish_date: '2026-01-01' };
    const payload = buildEdmPayload(weekly, [article({ id: 1, category_id: 1 })], helpers, { maxCategory: 3 });
    expect(payload).toHaveProperty('section3_title');
    expect(payload).not.toHaveProperty('section4_title');
  });
});
