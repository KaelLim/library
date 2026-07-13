import { describe, it, expect } from 'vitest';
import { stripFrontmatter, loadSkillSystemPrompt } from '../../src/services/skill-loader.js';

describe('stripFrontmatter', () => {
  it('removes leading frontmatter block', () => {
    const input = `---
name: foo
description: bar
---

# Body content
Some paragraph.`;
    expect(stripFrontmatter(input)).toBe('# Body content\nSome paragraph.');
  });

  it('returns input unchanged when no frontmatter', () => {
    expect(stripFrontmatter('# No fm here')).toBe('# No fm here');
  });

  it('handles frontmatter with trailing blank line', () => {
    const input = `---\nname: x\n---\n\n\nActual`;
    expect(stripFrontmatter(input)).toBe('Actual');
  });
});

describe('loadSkillSystemPrompt', () => {
  it('loads parse-weekly skill and strips frontmatter', async () => {
    const body = await loadSkillSystemPrompt('parse-weekly');
    expect(body.startsWith('---')).toBe(false);
    expect(body).toContain('解析週報 Markdown');
  });

  it('throws for missing skill with skill name in message', async () => {
    await expect(loadSkillSystemPrompt('does-not-exist')).rejects.toThrow(/does-not-exist/);
  });
});
