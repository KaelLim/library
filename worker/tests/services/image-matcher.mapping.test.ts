import { describe, it, expect } from 'vitest';
import {
  buildFolderMappingPrompt,
  validateFolderMappingResponse,
} from '../../src/services/image-matcher.js';

describe('buildFolderMappingPrompt', () => {
  it('embeds all subfolder ids+names and the 1-8 category table', () => {
    const prompt = buildFolderMappingPrompt([
      { id: 'fA', name: '一版全球焦點' },
      { id: 'fB', name: '二版 上人開示' },
    ]);
    expect(prompt).toContain('fA');
    expect(prompt).toContain('一版全球焦點');
    expect(prompt).toContain('fB');
    expect(prompt).toContain('證嚴上人開示'); // category 2 reference name
    expect(prompt).toMatch(/category_id/i);
  });
});

describe('validateFolderMappingResponse', () => {
  const ids = ['fA', 'fB', 'fC'];

  it('accepts valid response', () => {
    const raw = {
      mappings: [
        { folder_id: 'fA', category_id: 1 },
        { folder_id: 'fB', category_id: 2 },
      ],
      unmapped: ['fC'],
    };
    const result = validateFolderMappingResponse(raw, ids);
    expect(result.mappings.get('fA')).toBe(1);
    expect(result.mappings.get('fB')).toBe(2);
    expect(result.unmapped).toEqual(['fC']);
  });

  it('drops out-of-range category_id to unmapped', () => {
    const raw = {
      mappings: [
        { folder_id: 'fA', category_id: 1 },
        { folder_id: 'fB', category_id: 99 },
      ],
      unmapped: [],
    };
    const result = validateFolderMappingResponse(raw, ids);
    expect(result.mappings.has('fB')).toBe(false);
    expect(result.unmapped).toContain('fB');
  });

  it('drops duplicate category_id collisions (all losers)', () => {
    const raw = {
      mappings: [
        { folder_id: 'fA', category_id: 3 },
        { folder_id: 'fB', category_id: 3 },
        { folder_id: 'fC', category_id: 5 },
      ],
      unmapped: [],
    };
    const result = validateFolderMappingResponse(raw, ids);
    expect(result.mappings.has('fA')).toBe(false);
    expect(result.mappings.has('fB')).toBe(false);
    expect(result.mappings.get('fC')).toBe(5);
    expect(result.unmapped).toEqual(expect.arrayContaining(['fA', 'fB']));
  });

  it('treats folder_ids missing from AI response as unmapped', () => {
    const raw = { mappings: [{ folder_id: 'fA', category_id: 1 }], unmapped: [] };
    const result = validateFolderMappingResponse(raw, ids);
    expect(result.unmapped).toEqual(expect.arrayContaining(['fB', 'fC']));
  });

  it('treats non-object input as fully unmapped', () => {
    const result = validateFolderMappingResponse('not a mapping', ids);
    expect(result.mappings.size).toBe(0);
    expect(result.unmapped).toEqual(ids);
  });
});
