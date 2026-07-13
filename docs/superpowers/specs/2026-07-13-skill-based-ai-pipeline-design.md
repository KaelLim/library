# Skill-Based AI Pipeline Design

## Goal

Refactor the worker's AI pipeline from inline prompts into named specialists, each backed by a proper Claude Agent SDK skill file. Split the current two AI functions into four specialists — three AI (parse, rewrite, describe) and one pure-code (Chinese numeral normalization). Digital-version content is guaranteed to use Arabic numerals for dates and quantities.

## Motivation

**Current pain points:**

1. `ai-parser.ts` and `ai-rewriter.ts` load `.claude/skills/*.md` as flat files and string-concatenate their contents into a runtime prompt. The `.md` files claim to be skills but the SDK never actually treats them as skills — they're just externalized prompt fragments.
2. `generateDescription` inline prompt lives in `ai-rewriter.ts:115-133`, mixed with the rewrite function that already returns a description. Two competing paths.
3. Editors ship weekly content with Chinese-character numerals for dates (`二〇二五年一月廿一日`) and quantities. Digital-version consumers (SEO, AI search snippets, dashboard filters) do worse with these forms; Arabic numerals are more universal.
4. Each AI call is a monolithic prompt. Debugging "which prompt did what" or A/B-testing a single step requires editing shared inline strings.

**Constraints:**

- Worker's `session-streamer` broadcasts token-level output to Supabase Realtime — must be preserved per specialist so the dashboard's live tail keeps working.
- Deterministic ordering: parse → rewrite → describe → normalize. Not a chat/delegation flow.
- `@anthropic-ai/claude-agent-sdk@^0.2.19` supports `systemPrompt: string`, `agents:`, and `settingSources` — we use `systemPrompt` for direct-invoke specialists; `agents:` is designed for LLM-dispatched delegation which we don't want here.

## Scope

**In scope:**
- Reorganize `.claude/skills/` into SDK-standard folder-per-skill layout, one `SKILL.md` per specialist.
- Extract `generateDescription` inline prompt into its own skill file.
- Extend `session-streamer.runSessionWithStreaming` to accept an optional `systemPrompt`; skill loader strips frontmatter and passes body as system prompt.
- Add `worker/src/services/normalize-numbers.ts` — pure-code Chinese → Arabic numeral converter for a conservative allowlist of contexts.
- Wire normalizer into worker.ts's `ai_rewriting` step: after `rewriteForDigital` returns, apply `normalizeNumbers` to `title`, `description`, `content` before writing to DB. Only `digital` platform.
- Add per-specialist debug logging tag so streamer output can be attributed.

**Out of scope:**
- Migrating to SDK's `agents:` orchestrator pattern (LLM-delegated) — different tradeoff, reconsider later.
- Refactoring skill *content* — we move the files as-is; content improvements are separate iterations.
- Rewriting the AI parser's structural strategy (item 3 already changed the image side; parser remains AI-driven).
- Backfilling numeral normalization on existing DB rows — new imports only.
- Adding an AI-based number normalizer fallback — pure code covers the priority patterns; revisit if editors report gaps.

## Design

### Directory layout

```
.claude/skills/
├── parse-weekly/
│   └── SKILL.md         # moved from parse-weekly.md, content unchanged
├── rewrite-for-digital/
│   └── SKILL.md         # moved from rewrite-for-digital.md, content unchanged
└── generate-description/
    └── SKILL.md         # extracted from ai-rewriter.ts inline prompt
```

Each `SKILL.md` starts with frontmatter:

```markdown
---
name: <skill-name>
description: <one-line purpose>
---

<body — used as the AI system prompt>
```

### Skill loader

New helper (in existing `ai-parser.ts` or new `worker/src/services/skill-loader.ts`):

```ts
export async function loadSkillSystemPrompt(skillName: string): Promise<string> {
  const path = join(__dirname, '../../../.claude/skills', skillName, 'SKILL.md');
  const raw = await readFile(path, 'utf-8');
  return stripFrontmatter(raw);
}
```

Frontmatter stripping — remove the leading `---\n...\n---\n` block and any trailing whitespace before the first content line. Deterministic regex `/^---\n[\s\S]*?\n---\n\s*/`.

### session-streamer extension

Extend `SessionStreamOptions`:

```diff
 export interface SessionStreamOptions {
   weeklyId: number;
   model?: string;
   allowedTools?: string[];
   maxTurns?: number;
   chunkSize?: number;
+  systemPrompt?: string;    // optional custom system prompt (skill body)
+  logTag?: string;          // e.g. 'parse-weekly'; prefixed to console logs
 }
```

Pass `systemPrompt` into `query({ options: { systemPrompt, ... } })`. When absent, keep current behavior (SDK's default `claude_code` preset).

Update console log lines from `[Query]` to `[Query:${logTag}]` when a tag is provided — makes tail logs attributable across specialists during multi-article rewrites.

### Specialist services (renamed/split)

`ai-parser.ts` renamed to `parse-weekly.service.ts`; `ai-rewriter.ts` split into `rewrite-for-digital.service.ts` + `generate-description.service.ts`. Public function names preserved so worker.ts / routes untouched at call sites. Old file paths become thin re-export shims for one commit cycle (see Migration).

Each specialist function:

```ts
export async function parseWeeklyMarkdown(markdown, weeklyId): Promise<ParsedWeekly> {
  const systemPrompt = await loadSkillSystemPrompt('parse-weekly');
  const userPrompt = `<CRITICAL OUTPUT CONTRACT>...<data>${markdown}`;
  const raw = await runSessionWithStreaming(userPrompt, {
    weeklyId, model: 'opus', systemPrompt, logTag: 'parse-weekly',
  });
  // existing extractJsonObject + validation ...
}
```

`rewriteForDigital` — same pattern, `systemPrompt = loadSkillSystemPrompt('rewrite-for-digital')`. User prompt keeps the JSON-output contract + inputs (title, content, categoryName).

`generateDescription` — same pattern, `systemPrompt = loadSkillSystemPrompt('generate-description')`. User prompt is only `{title, content-truncated-2000, categoryName}`.

### `.claude/skills/generate-description/SKILL.md` (new)

Extract the existing inline prompt in `ai-rewriter.ts:115-133`:

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

### Number normalizer (pure code)

`worker/src/services/normalize-numbers.ts` — no AI, no external deps.

**Conversion rules (conservative allowlist):**

1. **4-digit year followed by 年**
   - Pattern: `[〇○零一二三四五六七八九]{4}年`
   - Example: `二〇二五年` → `2025年`; `二○二五年` → `2025年`; `一九九九年` → `1999年`

2. **Month / day with optional 十/廿/卅 tens digit followed by 月/日**
   - Pattern: composite regex covering `[一二三四五六七八九]?十[一二三四五六七八九]?(月|日)` and `廿[一二三四五六七八九]?(月|日)` and `卅[一]?(月|日)`
   - Example: `一月廿一日` → `1月21日`; `十二月三十日` → `12月30日`

3. **Hour / minute (24-hour)**
   - Pattern: `[一二三四五六七八九]?十?[一二三四五六七八九]?(時|點|分)`
   - Constraint: computed value must be in range for the unit (0–24 for 時/點, 0–59 for 分) — otherwise skip
   - Example: `下午三時` → `下午3時`; `二十四時` → `24時`; but `一百時` won't match (no measure sequence)

4. **Small-integer quantity + measure word**
   - Allowlist of measure words: `人|位|名|次|場|件|戶|所|間|棟|輛|台|支|隻|張|冊|本|篇|坪|公斤|公里|公尺|元|年來|週年`
   - Pattern: `[〇○零一二三四五六七八九]{1,3}` (positional up to 3 digits) OR multiplicative like `[一二三四五六七八九]?十[一二三四五六七八九]?` followed by measure word
   - Example: `六戶居民` → `6戶居民`; `三十二人參加` → `32人參加`

**Preserved (NOT converted):**
- Category / version titles: `一版`, `二版` … `八版`, `第一版` — these are structural identifiers, not values
- Ordinal without measure word: `第一次` → keep `第一` unchanged
- Proper names, titles, idioms, poetry: any Chinese numeral in an idiomatic phrase — the allowlist naturally excludes these because we only match specific unit tails
- Chinese numerals in image alt text / image URLs (URL-safe already, `x-x-x` codes are Arabic)

**API:**

```ts
export interface NormalizeResult {
  text: string;
  conversions: { original: string; replacement: string; kind: 'year' | 'date' | 'time' | 'quantity' }[];
}

export function normalizeNumbers(input: string): NormalizeResult;
```

Returns the transformed string plus an audit trail of every substitution. Worker logs the audit trail per article for observability.

**Character maps:**

```ts
const CJK_DIGITS: Record<string, number> = {
  '〇': 0, '○': 0, '零': 0, '元': 0,
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
```

Wanting `兩` mapped to 2 covers `兩年` → `2年` if `年` is on the measure-word allowlist. `元` mapped to 0 only fires in the 4-digit year pattern where `二〇` might be typed as `二元` (rare but seen). Neither introduces false positives in practice.

### Worker.ts wiring

`ai_rewriting` step — after `rewriteForDigital` returns, before insert:

```ts
const rewritten = await rewriteForDigital(...);

const t = normalizeNumbers(rewritten.title);
const d = normalizeNumbers(rewritten.description);
const c = normalizeNumbers(rewritten.content);

const totalConv = t.conversions.length + d.conversions.length + c.conversions.length;
if (totalConv > 0) {
  console.log(`[normalize-numbers] article "${rewritten.title.slice(0, 40)}": ${totalConv} conversions`);
}

const inserted = await insertArticle({
  ...
  title: t.text,
  description: d.text,
  content: c.text,
});

// audit log includes conversion summary
await writeAuditLog({
  ...
  metadata: { ..., number_conversions: totalConv },
});
```

Not applied to `docs` platform — original content is preserved verbatim.

### Error handling

- Skill file missing / malformed frontmatter → thrown by `loadSkillSystemPrompt`, propagates to worker's try/catch → `failed` progress step with clear error.
- `normalizeNumbers` is pure code; regex misfires would show up as unwanted conversions in the audit log. No runtime failure path.
- SDK `agents` typing conflict? — we don't set `agents:`, no interaction.

## Testing

**Approach: TDD.** Every specialist function and the normalizer are developed test-first — write the failing test with the target input/output, implement the minimal code to pass, extend the test set for edge cases before extending the function. The plan document breaks each specialist into red-green-refactor steps.

**Unit — `normalize-numbers.test.ts`:**

- Year: `二〇二五年一月廿一日清晨` → `2025年1月21日清晨` (2 conversions logged)
- Quantity + measure: `慈濟援助六戶居民` → `慈濟援助6戶居民`
- Preserve version title: `第一版` → `第一版` (unchanged, none logged)
- Preserve idiom: `一心一意` → `一心一意` (unchanged; no measure word)
- Multiplicative: `三十二位志工` → `32位志工`
- Composite: `二〇二五年一月廿一日清晨，強震重創嘉南山區，慈濟援助六戶居民` → all three converted
- Empty input → empty output, zero conversions
- Idempotent — running normalizer on its own output produces no additional conversions

**Unit — `skill-loader.test.ts`:**

- Loads `parse-weekly/SKILL.md` and strips frontmatter (asserts result starts with `# 解析週報 Markdown`, not `---`)
- Missing skill throws with clear message including skill name

**Integration — smoke via real SDK call (kept minimal to save tokens):**

- Existing smoke.test.ts unchanged; a new specialist can be exercised in dev by running the CLI import against a fixture.

**Regression:**

- Existing `parseWeeklyMarkdown` / `rewriteForDigital` / `generateDescription` public signatures unchanged — all call sites in worker.ts, routes, and any imports keep compiling.

## Migration

1. Move `.claude/skills/parse-weekly.md` → `.claude/skills/parse-weekly/SKILL.md` (git mv preserves history).
2. Move `.claude/skills/rewrite-for-digital.md` → `.claude/skills/rewrite-for-digital/SKILL.md`.
3. Add `.claude/skills/generate-description/SKILL.md` — content copied from ai-rewriter.ts inline prompt.
4. Rename `worker/src/services/ai-parser.ts` → `parse-weekly.service.ts`. Add a re-export shim at old path? — YAGNI, we update the imports in one commit. Any external CLI arguments referencing `ai-parser` stay unaffected (nothing does).
5. Split `ai-rewriter.ts` → `rewrite-for-digital.service.ts` (contains `rewriteForDigital` + `rewriteAllArticles` + image preservation helper) and `generate-description.service.ts` (`generateDescription`).
6. `worker/src/worker.ts` imports updated. `routes/*` import paths updated if any.
7. Extend `session-streamer.ts` with `systemPrompt` + `logTag`.
8. Add `normalize-numbers.ts` + wire into worker.
9. Add tests.
10. Build + run test suite.

## Rollout

- Merge to `main`.
- Rebuild worker container: `docker compose up -d --build worker`.
- No dashboard change needed (types unaffected).
- Editors don't need to change how they write documents — the normalizer runs downstream.
- After first real import, review audit_log's `number_conversions` metadata to confirm normalizer caught expected patterns without over-reaching.

## Non-goals

- SDK `agents:` orchestrator pattern.
- AI-based fallback normalizer.
- Editor-facing warnings for un-normalized numerals in `docs`.
- Historical DB backfill.
