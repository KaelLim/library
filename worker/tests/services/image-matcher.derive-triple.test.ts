import { describe, it, expect } from 'vitest';
import { deriveImageTripleMap } from '../../src/services/image-matcher.js';
import type { ParsedWeekly } from '../../src/types/index.js';

describe('deriveImageTripleMap', () => {
  it('assigns article index per-category (1-based) and image index per-article (1-based)', () => {
    const parsed: ParsedWeekly = {
      weekly_id: 140,
      categories: [
        {
          category_id: 1,
          name: '全球焦點',
          sort_order: 1,
          articles: [
            {
              title: 'A',
              content:
                '![](/x/images/image1.jpg) tail ![](/x/images/image2.png)',
            },
            { title: 'B', content: '![](/x/images/image3.jpg)' },
          ],
        },
        {
          category_id: 3,
          name: '慈濟要聞',
          sort_order: 3,
          articles: [{ title: 'C', content: '![](/x/images/image7.jpg)' }],
        },
      ],
    };
    const map = deriveImageTripleMap(parsed);
    expect(map.get('image1.jpg')).toEqual({ categoryId: 1, articleIdx: 1, imageIdx: 1 });
    expect(map.get('image2.png')).toEqual({ categoryId: 1, articleIdx: 1, imageIdx: 2 });
    expect(map.get('image3.jpg')).toEqual({ categoryId: 1, articleIdx: 2, imageIdx: 1 });
    expect(map.get('image7.jpg')).toEqual({ categoryId: 3, articleIdx: 1, imageIdx: 1 });
    expect(map.size).toBe(4);
  });

  it('first occurrence wins when same filename appears in multiple categories', () => {
    const parsed: ParsedWeekly = {
      weekly_id: 1,
      categories: [
        {
          category_id: 2,
          name: 'X',
          sort_order: 2,
          articles: [{ title: 'A', content: '![](/x/images/image9.jpg)' }],
        },
        {
          category_id: 5,
          name: 'Y',
          sort_order: 5,
          articles: [{ title: 'B', content: '![](/x/images/image9.jpg)' }],
        },
      ],
    };
    expect(deriveImageTripleMap(parsed).get('image9.jpg')).toEqual({
      categoryId: 2,
      articleIdx: 1,
      imageIdx: 1,
    });
  });

  it('returns empty map when there are no image references', () => {
    const parsed: ParsedWeekly = {
      weekly_id: 1,
      categories: [
        {
          category_id: 1,
          name: 'X',
          sort_order: 1,
          articles: [{ title: 'A', content: 'no images' }],
        },
      ],
    };
    expect(deriveImageTripleMap(parsed).size).toBe(0);
  });

  it('returns empty map for empty categories array', () => {
    expect(deriveImageTripleMap({ weekly_id: 1, categories: [] }).size).toBe(0);
  });

  it('articleIdx counts only within its own category, not globally', () => {
    const parsed: ParsedWeekly = {
      weekly_id: 1,
      categories: [
        {
          category_id: 1,
          name: 'X',
          sort_order: 1,
          articles: [
            { title: 'A', content: '![](/x/images/image1.jpg)' },
            { title: 'B', content: '![](/x/images/image2.jpg)' },
          ],
        },
        {
          category_id: 2,
          name: 'Y',
          sort_order: 2,
          articles: [{ title: 'C', content: '![](/x/images/image3.jpg)' }],
        },
      ],
    };
    const map = deriveImageTripleMap(parsed);
    expect(map.get('image3.jpg')).toEqual({ categoryId: 2, articleIdx: 1, imageIdx: 1 });
  });
});
