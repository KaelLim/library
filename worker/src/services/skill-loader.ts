import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// dev: worker/src/services -> worker/.claude/skills
// prod: /app/dist/services -> /app/.claude/skills
const SKILLS_ROOT = join(__dirname, '../../.claude/skills');

const FRONTMATTER_REGEX = /^---\n[\s\S]*?\n---\n\s*/;

export function stripFrontmatter(text: string): string {
  return text.replace(FRONTMATTER_REGEX, '');
}

export async function loadSkillSystemPrompt(skillName: string): Promise<string> {
  const path = join(SKILLS_ROOT, skillName, 'SKILL.md');
  try {
    const raw = await readFile(path, 'utf-8');
    return stripFrontmatter(raw);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load skill "${skillName}" at ${path}: ${cause}`);
  }
}
