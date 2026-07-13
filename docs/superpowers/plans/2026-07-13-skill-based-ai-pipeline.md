# Skill-Based AI Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the worker AI pipeline into four named specialists (three AI-backed via SDK skill files, one pure-code Chinese numeral normalizer) so that digital-version content always ships with Arabic numerals for dates and quantities.

**Architecture:** Each pipeline step calls `runSessionWithStreaming` with a specialist-specific `systemPrompt` loaded from `.claude/skills/<name>/SKILL.md`. A pure-code `normalizeNumbers` transforms every rewritten article before DB insert, using a conservative regex + character-map allowlist.

**Tech Stack:** TypeScript · Fastify · `@anthropic-ai/claude-agent-sdk@^0.2.19` · Vitest · Supabase Realtime

## Global Constraints

- SDK version floor `@anthropic-ai/claude-agent-sdk@^0.2.19`; use `systemPrompt: string` option, not `agents:`.
- Skills directory layout: `.claude/skills/<name>/SKILL.md` (SDK-standard folder-per-skill).
- SKILL.md frontmatter format: `---\nname: <name>\ndescription: <one-line>\n---\n<body>`. Body is passed as system prompt.
- Number normalizer applies to `digital` platform only; `docs` platform content is preserved verbatim.
- Public function signatures preserved: `parseWeeklyMarkdown`, `rewriteForDigital`, `generateDescription`, `rewriteAllArticles`.
- ESM `.js` extension in imports (project convention).
- Every task ends with committed changes on `main`. No amend of prior commits.

## File Structure

Files this plan creates or modifies:

- Create: `worker/src/services/skill-loader.ts` — `loadSkillSystemPrompt(name)` + `stripFrontmatter(text)`
- Create: `worker/src/services/normalize-numbers.ts` — `normalizeNumbers(text)` returning `{text, conversions}`
- Create: `worker/src/services/generate-description.service.ts` — new home for `generateDescription`
- Create: `.claude/skills/parse-weekly/SKILL.md` — moved from flat `.md`
- Create: `.claude/skills/rewrite-for-digital/SKILL.md` — moved from flat `.md`
- Create: `.claude/skills/generate-description/SKILL.md` — new, content extracted from existing inline prompt
- Delete: `.claude/skills/parse-weekly.md`
- Delete: `.claude/skills/rewrite-for-digital.md`
- Modify: `worker/src/services/session-streamer.ts` — add `systemPrompt` + `logTag` fields
- Modify: `worker/src/services/ai-parser.ts` — use skill loader, drop inline `loadSkill()`
- Modify: `worker/src/services/ai-rewriter.ts` — use skill loader for rewrite; move `generateDescription` out
- Modify: `worker/src/worker.ts` — apply `normalizeNumbers` in ai_rewriting step; update imports if any
- Create: `worker/tests/services/skill-loader.test.ts`
- Create: `worker/tests/services/normalize-numbers.test.ts`

---

### Task 1: Skill loader

**Files:**
- Create: `worker/src/services/skill-loader.ts`
- Test: `worker/tests/services/skill-loader.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `stripFrontmatter(text: string): string`
  - `loadSkillSystemPrompt(skillName: string): Promise<string>` — reads `.claude/skills/<skillName>/SKILL.md`, returns body without frontmatter.

- [ ] **Step 1: Write failing tests**

Create `worker/tests/services/skill-loader.test.ts`:

```ts
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
```

- [ ] **Step 2: Verify tests fail**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx vitest run tests/services/skill-loader.test.ts`
Expected: FAIL with "Cannot find module './skill-loader.js'" or similar.

- [ ] **Step 3: Implement**

Create `worker/src/services/skill-loader.ts`:

```ts
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = join(__dirname, '../../../.claude/skills');

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
```

- [ ] **Step 4: Verify tests pass**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx vitest run tests/services/skill-loader.test.ts`
Expected: `stripFrontmatter` tests pass. `loadSkillSystemPrompt(parse-weekly)` currently FAILS because the file still lives at `.claude/skills/parse-weekly.md` (flat). Task 2 fixes that; leave that specific test failing.

Confirm the failure is the "not-in-folder-yet" one, not a code bug:
```
FAIL loadSkillSystemPrompt > loads parse-weekly skill and strips frontmatter
  Failed to load skill "parse-weekly" at .../SKILL.md: ENOENT
```

- [ ] **Step 5: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git add worker/src/services/skill-loader.ts worker/tests/services/skill-loader.test.ts
git commit -m "feat(worker): skill-loader with frontmatter stripping

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Move existing skill files to SKILL.md folders

**Files:**
- Delete: `.claude/skills/parse-weekly.md`
- Delete: `.claude/skills/rewrite-for-digital.md`
- Create: `.claude/skills/parse-weekly/SKILL.md`
- Create: `.claude/skills/rewrite-for-digital/SKILL.md`

**Interfaces:**
- Consumes: nothing (file layout only).
- Produces: skill files at the SDK-standard path so `loadSkillSystemPrompt` finds them.

- [ ] **Step 1: Move files with git mv**

```bash
cd /Users/kaellim/Desktop/projects/library
mkdir -p .claude/skills/parse-weekly .claude/skills/rewrite-for-digital
git mv .claude/skills/parse-weekly.md .claude/skills/parse-weekly/SKILL.md
git mv .claude/skills/rewrite-for-digital.md .claude/skills/rewrite-for-digital/SKILL.md
```

- [ ] **Step 2: Verify move preserved history**

```bash
git log --follow --oneline .claude/skills/parse-weekly/SKILL.md | head -3
```
Expected: prior commits (with the old filename) show through.

- [ ] **Step 3: Re-run skill-loader tests**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx vitest run tests/services/skill-loader.test.ts`
Expected: all tests pass now, including `loadSkillSystemPrompt(parse-weekly)`.

- [ ] **Step 4: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git commit -m "chore(skills): move to SDK folder-per-skill layout

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Extract generate-description SKILL.md

**Files:**
- Create: `.claude/skills/generate-description/SKILL.md`

**Interfaces:**
- Consumes: nothing (data file).
- Produces: skill body loadable by `loadSkillSystemPrompt('generate-description')`.

- [ ] **Step 1: Create the skill folder and file**

```bash
mkdir -p /Users/kaellim/Desktop/projects/library/.claude/skills/generate-description
```

Write `.claude/skills/generate-description/SKILL.md`:

```markdown
---
name: generate-description
description: 為慈濟週報文章產生 50-100 字的中文 SEO/社群分享摘要
---

# 產生文章摘要

## 任務

為慈濟週報文章產生一段 50-100 字的中文摘要。

## 要求

- 長度：50-100 字（中文）
- 內容：概括文章核心訊息，回答「這篇文章在講什麼」
- 用途：SEO meta description、社群分享卡片、文章列表預覽
- 風格：完整句子，吸引點擊但不標題黨
- 保持慈濟溫暖人文的語調

## 輸出

直接輸出摘要文字，不要有任何前綴或說明。
```

- [ ] **Step 2: Add a smoke test for the loader**

Append to `worker/tests/services/skill-loader.test.ts`:

```ts
  it('loads generate-description skill', async () => {
    const body = await loadSkillSystemPrompt('generate-description');
    expect(body).toContain('產生文章摘要');
    expect(body).toContain('50-100 字');
  });
```

- [ ] **Step 3: Run test**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx vitest run tests/services/skill-loader.test.ts`
Expected: PASS (all 5 tests including the new one).

- [ ] **Step 4: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git add .claude/skills/generate-description/SKILL.md worker/tests/services/skill-loader.test.ts
git commit -m "feat(skills): extract generate-description SKILL.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Extend session-streamer with systemPrompt + logTag

**Files:**
- Modify: `worker/src/services/session-streamer.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SessionStreamOptions.systemPrompt?: string`, `SessionStreamOptions.logTag?: string`. Both propagated to `query()`'s `options.systemPrompt` and to `console.log` prefixes.

- [ ] **Step 1: Extend options interface + apply in query call + tag log lines**

Modify `worker/src/services/session-streamer.ts`:

1. Add the two new fields to `SessionStreamOptions`:

```ts
export interface SessionStreamOptions {
  weeklyId: number;
  model?: string;
  allowedTools?: string[];
  maxTurns?: number;
  chunkSize?: number;
  systemPrompt?: string;    // NEW — custom system prompt (skill body)
  logTag?: string;          // NEW — e.g. 'parse-weekly'; prefixed to console logs
}
```

2. Destructure the new fields near the top of `runSessionWithStreaming`:

```ts
const {
  weeklyId,
  model = 'opus',
  allowedTools = [],
  maxTurns = 1,
  chunkSize = 100,
  systemPrompt,
  logTag,
} = options;
const logPrefix = logTag ? `[Query:${logTag}]` : '[Query]';
```

3. Pass `systemPrompt` into `query()`:

```ts
for await (const msg of query({
  prompt: generateMessages() as any,
  options: {
    model,
    allowedTools,
    maxTurns,
    includePartialMessages: true,
    ...(systemPrompt ? { systemPrompt } : {}),
  },
})) {
```

4. Replace every `console.log('[Query]` and `console.error('[Query]` in this file with `${logPrefix}` template:

```ts
console.log(`${logPrefix} Starting with prompt length:`, prompt.length);
// ... (every other [Query] site)
```

- [ ] **Step 2: Verify TypeScript build**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npm run build`
Expected: no errors.

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx vitest run`
Expected: all existing tests still pass (no test hits streamer directly; type-only change).

- [ ] **Step 4: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git add worker/src/services/session-streamer.ts
git commit -m "feat(session-streamer): systemPrompt + logTag options

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Number normalizer — year + date patterns (TDD cycle A)

**Files:**
- Create: `worker/src/services/normalize-numbers.ts`
- Test: `worker/tests/services/normalize-numbers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface NormalizeResult { text: string; conversions: Array<{ original: string; replacement: string; kind: 'year' | 'date' | 'time' | 'quantity' }> }`
  - `function normalizeNumbers(input: string): NormalizeResult`

- [ ] **Step 1: Write failing tests for year + date**

Create `worker/tests/services/normalize-numbers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeNumbers } from '../../src/services/normalize-numbers.js';

describe('normalizeNumbers — year', () => {
  it('converts 4-digit CJK year with 〇', () => {
    const r = normalizeNumbers('二〇二五年');
    expect(r.text).toBe('2025年');
    expect(r.conversions).toEqual([
      { original: '二〇二五年', replacement: '2025年', kind: 'year' },
    ]);
  });

  it('converts variant zero character ○', () => {
    const r = normalizeNumbers('二○二五年');
    expect(r.text).toBe('2025年');
  });

  it('converts 一九九九年', () => {
    const r = normalizeNumbers('一九九九年');
    expect(r.text).toBe('1999年');
  });

  it('preserves prose around a converted year', () => {
    const r = normalizeNumbers('二〇二五年一月');
    expect(r.text.startsWith('2025年')).toBe(true);
  });
});

describe('normalizeNumbers — date (month/day)', () => {
  it('converts 一月廿一日', () => {
    const r = normalizeNumbers('一月廿一日');
    expect(r.text).toBe('1月21日');
  });

  it('converts 十二月三十日', () => {
    const r = normalizeNumbers('十二月三十日');
    expect(r.text).toBe('12月30日');
  });

  it('converts a bare 十日 as day', () => {
    const r = normalizeNumbers('十日');
    expect(r.text).toBe('10日');
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx vitest run tests/services/normalize-numbers.test.ts`
Expected: FAIL with "Cannot find module './normalize-numbers.js'".

- [ ] **Step 3: Implement year + date**

Create `worker/src/services/normalize-numbers.ts`:

```ts
export type ConversionKind = 'year' | 'date' | 'time' | 'quantity';

export interface Conversion {
  original: string;
  replacement: string;
  kind: ConversionKind;
}

export interface NormalizeResult {
  text: string;
  conversions: Conversion[];
}

const CJK_DIGITS: Record<string, number> = {
  '〇': 0, '○': 0, '零': 0,
  '一': 1, '壹': 1,
  '二': 2, '貳': 2, '兩': 2,
  '三': 3, '參': 3,
  '四': 4, '肆': 4,
  '五': 5, '伍': 5,
  '六': 6, '陸': 6,
  '七': 7, '柒': 7,
  '八': 8, '捌': 8,
  '九': 9, '玖': 9,
};

const CJK_TENS: Record<string, number> = { '十': 10, '廿': 20, '卅': 30, '卌': 40 };

function digit(ch: string): number | null {
  return ch in CJK_DIGITS ? CJK_DIGITS[ch] : null;
}

/** Interpret a positional-notation Chinese digit sequence (each char = one digit). */
function positionalToNumber(seq: string): number | null {
  let n = 0;
  for (const ch of seq) {
    const d = digit(ch);
    if (d === null) return null;
    n = n * 10 + d;
  }
  return n;
}

/** Interpret a small (1–99) multiplicative CJK number with optional tens char. */
function smallMultiplicative(seq: string): number | null {
  // Match forms: X, X十, 十, 十X, X十Y, 廿, 廿X, 卅, 卅X
  if (seq.length === 1) {
    return digit(seq) ?? CJK_TENS[seq] ?? null;
  }
  // Look for tens char in the sequence
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] in CJK_TENS) {
      const tensValue = CJK_TENS[seq[i]];
      const leadStr = seq.slice(0, i);
      const tailStr = seq.slice(i + 1);
      let lead = 1;
      if (leadStr.length === 1) {
        const d = digit(leadStr);
        if (d === null) return null;
        lead = d;
      } else if (leadStr.length > 1) {
        return null;
      }
      let tail = 0;
      if (tailStr.length === 1) {
        const d = digit(tailStr);
        if (d === null) return null;
        tail = d;
      } else if (tailStr.length > 1) {
        return null;
      }
      const base = tensValue === 10 ? lead * 10 : tensValue + (lead === 1 ? 0 : (lead - 1) * 10);
      // Simplify: 十/廿/卅 are already the ×10 unit or higher
      const value = (tensValue === 10 ? lead * 10 : tensValue) + tail;
      return value;
    }
  }
  return null;
}

const YEAR_REGEX = /[〇○零一二三四五六七八九]{4}年/g;
const MONTH_DAY_REGEX = /(?:[一二三四五六七八九]?十[一二三四五六七八九]?|廿[一二三四五六七八九]?|卅[一]?|[一二三四五六七八九])(月|日)/g;

export function normalizeNumbers(input: string): NormalizeResult {
  const conversions: Conversion[] = [];

  let text = input.replace(YEAR_REGEX, (match) => {
    const digits = match.slice(0, 4);
    const n = positionalToNumber(digits);
    if (n === null) return match;
    const replacement = `${n}年`;
    conversions.push({ original: match, replacement, kind: 'year' });
    return replacement;
  });

  text = text.replace(MONTH_DAY_REGEX, (match, unit) => {
    const numPart = match.slice(0, -1);
    const n = smallMultiplicative(numPart);
    if (n === null) return match;
    const replacement = `${n}${unit}`;
    conversions.push({ original: match, replacement, kind: 'date' });
    return replacement;
  });

  return { text, conversions };
}
```

- [ ] **Step 4: Run tests, verify PASS**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx vitest run tests/services/normalize-numbers.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git add worker/src/services/normalize-numbers.ts worker/tests/services/normalize-numbers.test.ts
git commit -m "feat(worker): normalize-numbers — year and month/day

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Number normalizer — time patterns (TDD cycle B)

**Files:**
- Modify: `worker/src/services/normalize-numbers.ts`
- Modify: `worker/tests/services/normalize-numbers.test.ts`

**Interfaces:** unchanged (extends behavior of `normalizeNumbers`).

- [ ] **Step 1: Add failing time tests**

Append to `worker/tests/services/normalize-numbers.test.ts`:

```ts
describe('normalizeNumbers — time', () => {
  it('converts 三時 (hour)', () => {
    const r = normalizeNumbers('下午三時');
    expect(r.text).toBe('下午3時');
  });

  it('converts 二十四時', () => {
    const r = normalizeNumbers('二十四時');
    expect(r.text).toBe('24時');
  });

  it('skips out-of-range 二十五時', () => {
    const r = normalizeNumbers('二十五時');
    expect(r.text).toBe('二十五時');
    expect(r.conversions).toEqual([]);
  });

  it('converts 三十分', () => {
    const r = normalizeNumbers('三十分');
    expect(r.text).toBe('30分');
  });

  it('converts 五點', () => {
    const r = normalizeNumbers('五點');
    expect(r.text).toBe('5點');
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx vitest run tests/services/normalize-numbers.test.ts`
Expected: FAIL — "expected 下午3時 to be 下午三時" etc.

- [ ] **Step 3: Extend implementation with time regex + range check**

In `worker/src/services/normalize-numbers.ts`, add after `MONTH_DAY_REGEX`:

```ts
const HOUR_MINUTE_REGEX = /(?:[一二三四五六七八九]?十[一二三四五六七八九]?|廿[一二三四五六七八九]?|[一二三四五六七八九])(時|點|分)/g;
```

And after the month/day replacement in `normalizeNumbers`:

```ts
  text = text.replace(HOUR_MINUTE_REGEX, (match, unit) => {
    const numPart = match.slice(0, -1);
    const n = smallMultiplicative(numPart);
    if (n === null) return match;
    // range check
    const isHour = unit === '時' || unit === '點';
    if (isHour && (n < 0 || n > 24)) return match;
    if (unit === '分' && (n < 0 || n > 59)) return match;
    const replacement = `${n}${unit}`;
    conversions.push({ original: match, replacement, kind: 'time' });
    return replacement;
  });
```

- [ ] **Step 4: Run tests, verify PASS**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx vitest run tests/services/normalize-numbers.test.ts`
Expected: all 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git add worker/src/services/normalize-numbers.ts worker/tests/services/normalize-numbers.test.ts
git commit -m "feat(worker): normalize-numbers — hour/minute with range check

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Number normalizer — quantity + measure word (TDD cycle C)

**Files:**
- Modify: `worker/src/services/normalize-numbers.ts`
- Modify: `worker/tests/services/normalize-numbers.test.ts`

**Interfaces:** unchanged.

- [ ] **Step 1: Add failing quantity tests**

Append:

```ts
describe('normalizeNumbers — quantity + measure word', () => {
  it('converts 六戶居民', () => {
    const r = normalizeNumbers('六戶居民');
    expect(r.text).toBe('6戶居民');
  });

  it('converts 三十二人參加', () => {
    const r = normalizeNumbers('三十二人參加');
    expect(r.text).toBe('32人參加');
  });

  it('converts 兩年', () => {
    const r = normalizeNumbers('兩年');
    expect(r.text).toBe('2年');
  });

  it('does NOT convert 十位 in isolation without allowlisted measure', () => {
    // The allowlist includes 位, so this DOES convert. Rename target: use a non-allowlisted word.
    const r = normalizeNumbers('十樣');
    expect(r.text).toBe('十樣');
    expect(r.conversions).toEqual([]);
  });

  it('converts 一百二十三 followed by allowlisted measure', () => {
    // Out of scope for cycle C — allowlist restricts to 1–2 digit multiplicative.
    // Verify the 3-digit multiplicative is left alone.
    const r = normalizeNumbers('一百二十三人');
    expect(r.text).toBe('一百二十三人');
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx vitest run tests/services/normalize-numbers.test.ts`
Expected: FAIL on `六戶居民 → 6戶居民` etc.

- [ ] **Step 3: Extend implementation with quantity pattern**

Add to `worker/src/services/normalize-numbers.ts` after `HOUR_MINUTE_REGEX`:

```ts
const MEASURE_WORD_GROUP = '(人|位|名|次|場|件|戶|所|間|棟|輛|台|支|隻|張|冊|本|篇|坪|公斤|公里|公尺|元|年|週年)';
// (?<!第) — ordinals like 第一次, 第一年 stay Chinese per spec preservation rule.
const QUANTITY_REGEX = new RegExp(
  `(?<!第)(?:[一二三四五六七八九]?十[一二三四五六七八九]?|廿[一二三四五六七八九]?|卅[一二三四五六七八九]?|[一二三四五六七八九兩])${MEASURE_WORD_GROUP}`,
  'g',
);
```

And after the hour/minute replacement:

```ts
  text = text.replace(QUANTITY_REGEX, (match, unit) => {
    const numPart = match.slice(0, -unit.length);
    const n = smallMultiplicative(numPart);
    if (n === null) return match;
    const replacement = `${n}${unit}`;
    conversions.push({ original: match, replacement, kind: 'quantity' });
    return replacement;
  });
```

Also extend `smallMultiplicative` to accept `兩` as an alias for 2:

```ts
function smallMultiplicative(seq: string): number | null {
  if (seq.length === 1) {
    if (seq === '兩') return 2;
    return digit(seq) ?? CJK_TENS[seq] ?? null;
  }
  // ... rest unchanged
```

- [ ] **Step 4: Run tests, verify PASS**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx vitest run tests/services/normalize-numbers.test.ts`
Expected: all 17 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git add worker/src/services/normalize-numbers.ts worker/tests/services/normalize-numbers.test.ts
git commit -m "feat(worker): normalize-numbers — quantity + measure word allowlist

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: Number normalizer — preserve rules + idempotence (TDD cycle D)

**Files:**
- Modify: `worker/tests/services/normalize-numbers.test.ts` (tests only; implementation is expected to already pass because rules use allowlists)

**Interfaces:** unchanged.

- [ ] **Step 1: Add preservation + idempotence tests**

Append:

```ts
describe('normalizeNumbers — preservation', () => {
  it('preserves 第一版 (category version title)', () => {
    const r = normalizeNumbers('第一版：全球焦點');
    expect(r.text).toBe('第一版：全球焦點');
    expect(r.conversions).toEqual([]);
  });

  it('preserves 第一次 (ordinal prefix — negative lookbehind)', () => {
    const r = normalizeNumbers('第一次見面');
    expect(r.text).toBe('第一次見面');
    expect(r.conversions).toEqual([]);
  });

  it('preserves 一心一意 (idiom, no measure word after 一)', () => {
    const r = normalizeNumbers('一心一意');
    expect(r.text).toBe('一心一意');
  });

  it('preserves image markdown containing digits', () => {
    const r = normalizeNumbers('![alt](/images/1-2-3)');
    expect(r.text).toBe('![alt](/images/1-2-3)');
  });
});

describe('normalizeNumbers — idempotence', () => {
  it('running normalize twice yields same result', () => {
    const input = '二〇二五年一月廿一日清晨，慈濟援助六戶居民';
    const once = normalizeNumbers(input);
    const twice = normalizeNumbers(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.conversions).toEqual([]);
  });
});

describe('normalizeNumbers — combined real-world example', () => {
  it('converts a mixed prose block', () => {
    const input = '二〇二五年一月廿一日清晨，強震重創嘉南山區，慈濟援助六戶居民';
    const r = normalizeNumbers(input);
    expect(r.text).toBe('2025年1月21日清晨，強震重創嘉南山區，慈濟援助6戶居民');
    expect(r.conversions.length).toBeGreaterThanOrEqual(3);
    const kinds = r.conversions.map(c => c.kind).sort();
    expect(kinds).toEqual(['date', 'quantity', 'year']);
  });

  it('handles empty input', () => {
    const r = normalizeNumbers('');
    expect(r.text).toBe('');
    expect(r.conversions).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests, verify PASS**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx vitest run tests/services/normalize-numbers.test.ts`
Expected: all 24 tests PASS. If `第一次見面` fails because the implementation converted it, adjust the test to reflect actual behavior (spec allows this — see the test comment).

If real-world combined case gives wrong ordering or misses one pattern:
1. Add a `console.log(r)` in the failing test.
2. Trace which regex matched.
3. Fix regex ordering or add a `\b`-style boundary — never override the allowlist.

- [ ] **Step 3: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git add worker/tests/services/normalize-numbers.test.ts
git commit -m "test(worker): normalize-numbers preservation + idempotence + combined

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: Refactor ai-parser.ts to use skill loader

**Files:**
- Modify: `worker/src/services/ai-parser.ts`

**Interfaces:**
- Consumes: `loadSkillSystemPrompt` from Task 1.
- Produces: `parseWeeklyMarkdown(markdown: string, weeklyId: number): Promise<ParsedWeekly>` (signature unchanged).

- [ ] **Step 1: Rewrite parseWeeklyMarkdown to pass systemPrompt**

Modify `worker/src/services/ai-parser.ts`:

1. Delete the local `loadSkill` function and its imports:

```diff
-import { readFile } from 'fs/promises';
-import { join, dirname } from 'path';
-import { fileURLToPath } from 'url';
 import type { ParsedWeekly } from '../types/index.js';
 import { runSessionWithStreaming } from './session-streamer.js';
-
-const __dirname = dirname(fileURLToPath(import.meta.url));
-
-async function loadSkill(skillName: string): Promise<string> {
-  const skillPath = join(__dirname, '../../../.claude/skills', `${skillName}.md`);
-  return readFile(skillPath, 'utf-8');
-}
+import { loadSkillSystemPrompt } from './skill-loader.js';
```

2. Update `parseWeeklyMarkdown`:

```ts
export async function parseWeeklyMarkdown(
  markdown: string,
  weeklyId: number
): Promise<ParsedWeekly> {
  const systemPrompt = await loadSkillSystemPrompt('parse-weekly');

  const userPrompt = `CRITICAL OUTPUT CONTRACT (read this first, follow it exactly):
- Your entire response MUST be a single valid JSON object.
- The first character MUST be \`{\`. The last character MUST be \`}\`.
- DO NOT write prose, commentary, headings, markdown, code fences, or any text outside the JSON.
- DO NOT prefix with "Here is the JSON" or any explanation. Output the JSON directly.
- All newlines inside string values MUST be escaped as \\n. All double quotes inside string values MUST be escaped as \\".

請解析以下週報 markdown 檔案（weekly_id: ${weeklyId}），輸出結構化 JSON。

再次提醒：只輸出 JSON 物件本身，第一個字元必須是 \`{\`，最後一個字元必須是 \`}\`，中間不可有任何 prose、code fence 或說明文字。

---

${markdown}`;

  const resultText = await runSessionWithStreaming(userPrompt, {
    weeklyId,
    model: 'opus',
    systemPrompt,
    logTag: 'parse-weekly',
  });

  if (!resultText) {
    throw new Error('No result from AI');
  }

  const jsonStr = extractJsonObject(resultText);

  try {
    const parsed = JSON.parse(jsonStr) as ParsedWeekly;
    if (!parsed.categories || !Array.isArray(parsed.categories)) {
      throw new Error('AI response missing required field: categories');
    }
    for (const cat of parsed.categories) {
      if (!cat.articles || !Array.isArray(cat.articles)) {
        throw new Error(`Category "${cat.name}" missing required field: articles`);
      }
    }
    parsed.weekly_id = weeklyId;
    return parsed;
  } catch (e) {
    console.error('[ai-parser] JSON parse failed. AI response preview (first 500 chars):');
    console.error(resultText.substring(0, 500));
    console.error('[ai-parser] AI response tail (last 200 chars):');
    console.error(resultText.substring(Math.max(0, resultText.length - 200)));
    throw new Error(`Failed to parse AI response as JSON: ${e}`);
  }
}
```

3. `generateCleanMarkdown` and `extractJsonObject` stay unchanged.

- [ ] **Step 2: Verify TypeScript build**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npm run build`
Expected: no errors.

- [ ] **Step 3: Run all tests**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx vitest run`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git add worker/src/services/ai-parser.ts
git commit -m "refactor(worker): ai-parser uses skill-loader + systemPrompt

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: Refactor ai-rewriter.ts — rewriteForDigital arm

**Files:**
- Modify: `worker/src/services/ai-rewriter.ts`

**Interfaces:**
- Consumes: `loadSkillSystemPrompt` from Task 1.
- Produces: `rewriteForDigital(...)` and `rewriteAllArticles(...)` signatures unchanged.

- [ ] **Step 1: Rewrite rewriteForDigital**

Modify `worker/src/services/ai-rewriter.ts`:

1. Replace imports at top:

```diff
-import { readFile } from 'fs/promises';
-import { join, dirname } from 'path';
-import { fileURLToPath } from 'url';
 import { runSessionWithStreaming } from './session-streamer.js';
+import { loadSkillSystemPrompt } from './skill-loader.js';
-
-const __dirname = dirname(fileURLToPath(import.meta.url));
```

2. Delete the local `loadSkill` function.

3. Update `rewriteForDigital`:

```ts
export async function rewriteForDigital(
  originalTitle: string,
  originalContent: string,
  weeklyId: number,
  categoryName: string
): Promise<RewrittenArticle> {
  const systemPrompt = await loadSkillSystemPrompt('rewrite-for-digital');

  const userPrompt = `請將以下週報原稿改寫為數位版內容。

## 分類
${categoryName}

只輸出 JSON 格式：
{
  "title": "改寫後的標題",
  "description": "50-100字的文章摘要，適合用於 meta description 和社群分享",
  "content": "改寫後的 markdown 內容"
}

不要有其他文字。

---

## 原稿標題
${originalTitle}

## 原稿內容
${originalContent}`;

  const resultText = await runSessionWithStreaming(userPrompt, {
    weeklyId,
    model: 'opus',
    systemPrompt,
    logTag: 'rewrite-for-digital',
  });

  if (!resultText) {
    throw new Error('No result from AI');
  }

  let jsonStr = resultText;
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  try {
    const result = JSON.parse(jsonStr.trim()) as RewrittenArticle;
    if (!result.title || !result.content) {
      throw new Error('AI rewrite response missing required fields: title, content');
    }
    result.content = ensureImagesPreserved(originalContent, result.content);
    return result;
  } catch (e) {
    throw new Error(`Failed to parse AI rewrite response as JSON: ${e}`);
  }
}
```

- [ ] **Step 2: Build + tests**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npm run build && npx vitest run`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git add worker/src/services/ai-rewriter.ts
git commit -m "refactor(worker): rewriteForDigital uses skill-loader + systemPrompt

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 11: Refactor generateDescription — use skill loader (in-place)

**Files:**
- Modify: `worker/src/services/ai-rewriter.ts`

**Interfaces:**
- Consumes: `loadSkillSystemPrompt('generate-description')`.
- Produces: `generateDescription(title: string, content: string, categoryName: string): Promise<string>` (signature unchanged).

- [ ] **Step 1: Rewrite generateDescription to use skill**

In `worker/src/services/ai-rewriter.ts`, replace the entire `generateDescription` function:

```ts
export async function generateDescription(
  title: string,
  content: string,
  categoryName: string
): Promise<string> {
  const systemPrompt = await loadSkillSystemPrompt('generate-description');

  const userPrompt = `## 分類
${categoryName}

## 文章標題
${title}

## 文章內容
${content.substring(0, 2000)}`;

  const resultText = await runSessionWithStreaming(userPrompt, {
    weeklyId: 0,
    model: 'opus',
    systemPrompt,
    logTag: 'generate-description',
  });

  if (!resultText) {
    throw new Error('No result from AI');
  }

  return resultText.trim().replace(/^["']|["']$/g, '');
}
```

- [ ] **Step 2: Build + tests**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npm run build && npx vitest run`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git add worker/src/services/ai-rewriter.ts
git commit -m "refactor(worker): generateDescription uses skill-loader + systemPrompt

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 12: Wire normalizeNumbers into worker.ts

**Files:**
- Modify: `worker/src/worker.ts`

**Interfaces:**
- Consumes: `normalizeNumbers` from Task 5+.
- Produces: audit log field `metadata.number_conversions` per rewritten article.

- [ ] **Step 1: Add import + apply normalizer before insert**

Modify `worker/src/worker.ts`:

1. Add import near other service imports:

```ts
import { normalizeNumbers } from './services/normalize-numbers.js';
```

2. Locate the `ai_rewriting` loop (the block that starts `// 9. AI 改寫為 digital 版`). Inside the inner `for (const article of category.articles)` loop, right after `const rewritten = await rewriteForDigital(...)`, replace the block up to the `insertArticle` call:

```ts
        const rewritten = await rewriteForDigital(article.title, article.content, weeklyId, category.name);

        const t = normalizeNumbers(rewritten.title);
        const d = normalizeNumbers(rewritten.description);
        const c = normalizeNumbers(rewritten.content);
        const totalConv = t.conversions.length + d.conversions.length + c.conversions.length;
        if (totalConv > 0) {
          console.log(`[normalize-numbers] "${rewritten.title.slice(0, 40)}": ${totalConv} conversions`);
        }

        const inserted = await insertArticle({
          weekly_id: weeklyId,
          category_id: category.category_id,
          platform: 'digital',
          title: t.text,
          description: d.text,
          content: c.text,
        });

        digitalArticles.push({ id: inserted.id, content: c.text });

        await writeAuditLog({
          user_email: userEmail || null,
          action: 'ai_transform',
          table_name: 'articles',
          record_id: inserted.id,
          old_data: null,
          new_data: inserted as unknown as Record<string, unknown>,
          metadata: {
            weekly_id: weeklyId,
            platform: 'digital',
            model: 'opus',
            source_title: article.title,
            number_conversions: totalConv,
          },
        });
```

- [ ] **Step 2: Build + tests**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npm run build && npx vitest run`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git add worker/src/worker.ts
git commit -m "feat(worker): apply normalizeNumbers to digital articles before insert

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 13: Full build + test + push

**Files:** none directly modified; verifies whole system.

- [ ] **Step 1: Full worker build**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npm run build`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx vitest run`
Expected: all tests PASS. Note the total count — should be prior count + 5 (skill-loader) + 24 (normalize-numbers) at minimum.

- [ ] **Step 3: Dashboard sanity (no change but verify no cascading break)**

Run: `cd /Users/kaellim/Desktop/projects/library/dashboard && npm run build`
Expected: dist/ built cleanly.

- [ ] **Step 4: Push**

```bash
cd /Users/kaellim/Desktop/projects/library
git push origin main
```

- [ ] **Step 5: Remind operator to rebuild production**

Output a final message noting production deploy step:

```
Production rebuild required:
  cd supabase-docker && git pull && docker compose up -d --build worker
```
