import { describe, it, expect } from 'vitest';
import { deriveImageCategoryMap } from '../../src/services/image-matcher.js';
import type { ParsedWeekly } from '../../src/types/index.js';

describe('deriveImageCategoryMap', () => {
  it('maps each image filename to the category of its article', () => {
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
                '文字 ![alt1](/storage/v1/object/public/weekly/articles/140/images/image1.jpg) 更多文字 ![alt2](/storage/v1/object/public/weekly/articles/140/images/image2.png)',
            },
          ],
        },
        {
          category_id: 3,
          name: '慈濟要聞',
          sort_order: 3,
          articles: [
            {
              title: 'B',
              content: '![](/storage/v1/object/public/weekly/articles/140/images/image7.jpg)',
            },
          ],
        },
      ],
    };
    const map = deriveImageCategoryMap(parsed);
    expect(map.get('image1.jpg')).toBe(1);
    expect(map.get('image2.png')).toBe(1);
    expect(map.get('image7.jpg')).toBe(3);
    expect(map.size).toBe(3);
  });

  it('ignores duplicate occurrences — first article wins', () => {
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
    expect(deriveImageCategoryMap(parsed).get('image9.jpg')).toBe(2);
  });

  it('returns empty map when there are no images', () => {
    const parsed: ParsedWeekly = {
      weekly_id: 1,
      categories: [
        { category_id: 1, name: 'X', sort_order: 1, articles: [{ title: 'A', content: 'no images' }] },
      ],
    };
    expect(deriveImageCategoryMap(parsed).size).toBe(0);
  });
});
