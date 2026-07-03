# External PDF Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /books/r/ext` — a SSR route that renders the existing flip-book viewer for any HTTPS PDF whose host is on the `ALLOWED_PDF_HOSTS` allowlist (initially `tool.tzuchi-org.tw`), taking the URL and optional OG meta from query parameters.

**Architecture:** New pure `validatePdfUrl` module (unit-tested), a `parseAllowedHosts` env parser exposed for testing, and a new Fastify handler in `worker/src/server.ts` that reuses the existing `bookTemplate` + `escapeHtml` / `escapeAttr` / `safeJsonForScript` helpers. The worker never fetches the PDF itself — PDF.js in the browser does it, so no SSRF surface.

**Tech Stack:** TypeScript (NodeNext ESM), Fastify 4, vitest 2, sharp/PDF.js untouched, Node's built-in `URL`.

## Global Constraints

- Every relative import must end in `.js` (ESM `moduleResolution: nodenext`).
- Tests use `vitest`; keep them fully deterministic — no network, no env reads, no `Date.now()`, no `Math.random()`.
- New tests live under `worker/tests/services/`, mirroring existing `image-matcher.*.test.ts` style — `import { describe, it, expect } from 'vitest'` + one `describe` block per exported symbol.
- Every commit message uses the Conventional Commits prefix (`feat(...)`, `test(...)`, `docs(...)`, `chore(...)`) matching the project's `git log` style.
- Do **not** touch `books/index.html`, `books/src/app.ts`, Kong config, or the `dashboard`.
- Do **not** add a server-side PDF fetch or `HEAD` probe. PDF.js is the only entity that connects to the external host.
- Do **not** introduce any new npm dependency. `URL` is a global; `parseAllowedHosts` and `validatePdfUrl` are pure JS.
- Reference spec: `docs/superpowers/specs/2026-07-03-external-pdf-reader-design.md` — the authoritative contract for every task below.

---

## File Structure

| Path | Action | Purpose |
|------|--------|---------|
| `worker/src/services/pdf-url-validator.ts` | **create** | Two pure functions: `validatePdfUrl(src, allowedHosts)` and `parseAllowedHosts(raw)`. No I/O, no env reads. |
| `worker/tests/services/pdf-url-validator.test.ts` | **create** | Vitest suite for the two exports, one `describe` each. |
| `worker/src/server.ts` | **modify (~60 lines added)** | Import the validator, freeze `ALLOWED_PDF_HOSTS` at boot, register `GET /books/r/ext` before the `/books/r/*` wildcard so Fastify matches it first. |
| `worker/.env.example` | **modify** | Add `ALLOWED_PDF_HOSTS=` (empty by default). |
| `supabase-docker/docker-compose.yml` | **modify** | Forward `ALLOWED_PDF_HOSTS` into the `worker` service `environment:` block. |
| `worker/CLAUDE.md` | **modify** | Add the `/books/r/ext` route to the Book Reader section, cite the spec and the env var. |

`.env.example` (repo root vs. `worker/.env.example`) — confirm which file the project ships. From `worker/CLAUDE.md` the project has `worker/.env`, so `.env.example` is expected under `worker/`. Task 2 verifies this.

---

## Task 1: `validatePdfUrl` + `parseAllowedHosts` pure functions (TDD)

**Files:**
- Create: `worker/src/services/pdf-url-validator.ts`
- Test: `worker/tests/services/pdf-url-validator.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  ```ts
  export type PdfUrlError =
    | 'MISSING_SRC'
    | 'INVALID_SRC'      // (reserved; not returned by validatePdfUrl itself — handler uses it for array-typed query)
    | 'INVALID_URL'
    | 'INVALID_SCHEME'
    | 'HOST_NOT_ALLOWED'
    | 'URL_TOO_LONG';

  export type PdfUrlOk  = { ok: true;  url: URL };
  export type PdfUrlErr = { ok: false; error: PdfUrlError };

  export function validatePdfUrl(
    src: string | undefined,
    allowedHosts: readonly string[],
  ): PdfUrlOk | PdfUrlErr;

  export function parseAllowedHosts(raw: string | undefined): string[];
  ```

- [ ] **Step 1: Write the failing test file**

Create `worker/tests/services/pdf-url-validator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  validatePdfUrl,
  parseAllowedHosts,
} from '../../src/services/pdf-url-validator.js';

const ALLOW = ['tool.tzuchi-org.tw'] as const;

describe('validatePdfUrl', () => {
  it('rejects undefined src', () => {
    expect(validatePdfUrl(undefined, ALLOW)).toEqual({ ok: false, error: 'MISSING_SRC' });
  });

  it('rejects empty src', () => {
    expect(validatePdfUrl('', ALLOW)).toEqual({ ok: false, error: 'MISSING_SRC' });
  });

  it('rejects src over 2048 chars', () => {
    const long = 'https://tool.tzuchi-org.tw/' + 'a'.repeat(2048);
    expect(validatePdfUrl(long, ALLOW)).toEqual({ ok: false, error: 'URL_TOO_LONG' });
  });

  it('rejects unparseable URL', () => {
    expect(validatePdfUrl('not a url', ALLOW)).toEqual({ ok: false, error: 'INVALID_URL' });
  });

  it('rejects http scheme', () => {
    expect(validatePdfUrl('http://tool.tzuchi-org.tw/a.pdf', ALLOW))
      .toEqual({ ok: false, error: 'INVALID_SCHEME' });
  });

  it('rejects ftp scheme', () => {
    expect(validatePdfUrl('ftp://tool.tzuchi-org.tw/a.pdf', ALLOW))
      .toEqual({ ok: false, error: 'INVALID_SCHEME' });
  });

  it('rejects javascript: scheme', () => {
    expect(validatePdfUrl('javascript:alert(1)', ALLOW))
      .toEqual({ ok: false, error: 'INVALID_SCHEME' });
  });

  it('rejects URL with userinfo', () => {
    expect(validatePdfUrl('https://u:p@tool.tzuchi-org.tw/a.pdf', ALLOW))
      .toEqual({ ok: false, error: 'INVALID_URL' });
  });

  it('rejects URL with only username', () => {
    expect(validatePdfUrl('https://u@tool.tzuchi-org.tw/a.pdf', ALLOW))
      .toEqual({ ok: false, error: 'INVALID_URL' });
  });

  it('rejects IPv4 host', () => {
    expect(validatePdfUrl('https://127.0.0.1/a.pdf', ALLOW))
      .toEqual({ ok: false, error: 'INVALID_URL' });
  });

  it('rejects private IPv4 host', () => {
    expect(validatePdfUrl('https://192.168.0.5/a.pdf', ALLOW))
      .toEqual({ ok: false, error: 'INVALID_URL' });
  });

  it('rejects bracketed IPv6 host', () => {
    expect(validatePdfUrl('https://[::1]/a.pdf', ALLOW))
      .toEqual({ ok: false, error: 'INVALID_URL' });
  });

  it('rejects host not on allowlist', () => {
    expect(validatePdfUrl('https://evil.com/a.pdf', ALLOW))
      .toEqual({ ok: false, error: 'HOST_NOT_ALLOWED' });
  });

  it('rejects subdomain injection (evil.tool.tzuchi-org.tw)', () => {
    expect(validatePdfUrl('https://evil.tool.tzuchi-org.tw/a.pdf', ALLOW))
      .toEqual({ ok: false, error: 'HOST_NOT_ALLOWED' });
  });

  it('rejects suffix injection (tool.tzuchi-org.tw.evil.com)', () => {
    expect(validatePdfUrl('https://tool.tzuchi-org.tw.evil.com/a.pdf', ALLOW))
      .toEqual({ ok: false, error: 'HOST_NOT_ALLOWED' });
  });

  it('accepts mixed-case hostname (WHATWG URL lowercases it)', () => {
    const result = validatePdfUrl('https://Tool.Tzuchi-Org.Tw/a.pdf', ALLOW);
    expect(result.ok).toBe(true);
    expect((result as { ok: true; url: URL }).url.hostname).toBe('tool.tzuchi-org.tw');
  });

  it('accepts canonical https URL', () => {
    const result = validatePdfUrl('https://tool.tzuchi-org.tw/a.pdf', ALLOW);
    expect(result.ok).toBe(true);
  });

  it('preserves query string on accepted URL', () => {
    const result = validatePdfUrl('https://tool.tzuchi-org.tw/a.pdf?token=abc&x=1', ALLOW);
    expect(result.ok).toBe(true);
    expect((result as { ok: true; url: URL }).url.search).toBe('?token=abc&x=1');
  });

  it('empty allowlist rejects everything', () => {
    expect(validatePdfUrl('https://tool.tzuchi-org.tw/a.pdf', []))
      .toEqual({ ok: false, error: 'HOST_NOT_ALLOWED' });
  });
});

describe('parseAllowedHosts', () => {
  it('returns [] for undefined', () => {
    expect(parseAllowedHosts(undefined)).toEqual([]);
  });

  it('returns [] for empty string', () => {
    expect(parseAllowedHosts('')).toEqual([]);
  });

  it('trims whitespace and drops empty entries', () => {
    expect(parseAllowedHosts('  tool.tzuchi-org.tw , Foo.Bar , ,x  '))
      .toEqual(['tool.tzuchi-org.tw', 'foo.bar', 'x']);
  });

  it('lowercases hostnames', () => {
    expect(parseAllowedHosts('TOOL.tzuchi-org.tw'))
      .toEqual(['tool.tzuchi-org.tw']);
  });

  it('single host', () => {
    expect(parseAllowedHosts('tool.tzuchi-org.tw'))
      .toEqual(['tool.tzuchi-org.tw']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail (module missing)**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx vitest run tests/services/pdf-url-validator.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/services/pdf-url-validator.js"`.

- [ ] **Step 3: Implement the validator module**

Create `worker/src/services/pdf-url-validator.ts` with **exactly** this content:

```ts
// Pure validator + env parser for the /books/r/ext external-PDF reader.
// No I/O, no DNS, no env access. See docs/superpowers/specs/2026-07-03-external-pdf-reader-design.md

export type PdfUrlError =
  | 'MISSING_SRC'
  | 'INVALID_SRC'
  | 'INVALID_URL'
  | 'INVALID_SCHEME'
  | 'HOST_NOT_ALLOWED'
  | 'URL_TOO_LONG';

export type PdfUrlOk = { ok: true; url: URL };
export type PdfUrlErr = { ok: false; error: PdfUrlError };

const MAX_URL_LENGTH = 2048;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function isIpHost(hostname: string): boolean {
  if (IPV4_RE.test(hostname)) return true;
  // WHATWG URL exposes IPv6 hosts with the surrounding brackets stripped in
  // `hostname`, so any colon in the hostname is an IPv6 address.
  if (hostname.includes(':')) return true;
  return false;
}

export function validatePdfUrl(
  src: string | undefined,
  allowedHosts: readonly string[],
): PdfUrlOk | PdfUrlErr {
  if (src === undefined || src === '') return { ok: false, error: 'MISSING_SRC' };
  if (src.length > MAX_URL_LENGTH) return { ok: false, error: 'URL_TOO_LONG' };

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return { ok: false, error: 'INVALID_URL' };
  }

  if (url.protocol !== 'https:') return { ok: false, error: 'INVALID_SCHEME' };
  if (url.username !== '' || url.password !== '') return { ok: false, error: 'INVALID_URL' };
  if (isIpHost(url.hostname)) return { ok: false, error: 'INVALID_URL' };

  const host = url.hostname; // already lowercased by URL parser
  if (!allowedHosts.includes(host)) return { ok: false, error: 'HOST_NOT_ALLOWED' };

  return { ok: true, url };
}

export function parseAllowedHosts(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx vitest run tests/services/pdf-url-validator.test.ts`
Expected: PASS, all 24 tests green (19 `validatePdfUrl` + 5 `parseAllowedHosts`).

- [ ] **Step 5: Type-check the whole worker**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx tsc --noEmit`
Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git add worker/src/services/pdf-url-validator.ts worker/tests/services/pdf-url-validator.test.ts
git commit -m "$(cat <<'EOF'
feat(pdf-url-validator): add pure allowlist + parser for external PDF reader

New module worker/src/services/pdf-url-validator.ts with:
- validatePdfUrl(src, allowedHosts): enforces https, no userinfo, no IP
  hosts, exact hostname match against allowlist, 2048-char cap.
- parseAllowedHosts(raw): trims/lowercases/drops empties on comma-split.

23 vitest cases cover every rule + happy-path preservation of URL search.
No env reads, no I/O — the /books/r/ext handler in a later task supplies
the allowlist.
EOF
)"
```

---

## Task 2: Env plumbing — `.env.example` + `docker-compose.yml`

**Files:**
- Modify: `worker/.env.example` — add `ALLOWED_PDF_HOSTS=` at the end of the file
- Modify: `supabase-docker/docker-compose.yml` — inside the `worker` service `environment:` block, add `ALLOWED_PDF_HOSTS: ${ALLOWED_PDF_HOSTS:-}`

**Interfaces:**
- Consumes: nothing (config only).
- Produces: the env var `ALLOWED_PDF_HOSTS` reachable inside the worker container. Task 3's `server.ts` will read `process.env.ALLOWED_PDF_HOSTS` and pass it to `parseAllowedHosts` at boot.

- [ ] **Step 1: Verify `worker/.env.example` exists**

Run: `ls /Users/kaellim/Desktop/projects/library/worker/.env.example`
Expected: file exists. If it does not, create it as an empty file first:

```bash
touch /Users/kaellim/Desktop/projects/library/worker/.env.example
```

- [ ] **Step 2: Append the new env var to `worker/.env.example`**

Read the file with `Read` to see the existing content, then use `Edit` to append after the last line:

```
# External PDF reader (/books/r/ext) — comma-separated hostnames the reader will accept.
# Leave empty to reject all external URLs. See spec 2026-07-03-external-pdf-reader-design §8.
ALLOWED_PDF_HOSTS=tool.tzuchi-org.tw
```

- [ ] **Step 3: Locate the `worker` service block in `docker-compose.yml`**

Read `/Users/kaellim/Desktop/projects/library/supabase-docker/docker-compose.yml` and find the block that starts with `worker:` (search for `worker:` at column 3 — it is the service definition). Confirm it has an `environment:` sub-block.

- [ ] **Step 4: Add the env forward inside the worker service**

Use `Edit` to add this line inside the worker's `environment:` block (keep alphabetical ordering with neighbours where the file already does so; otherwise append at the end of the block):

```yaml
      ALLOWED_PDF_HOSTS: ${ALLOWED_PDF_HOSTS:-}
```

The `:-` default keeps the container startable when the var is unset on the host.

- [ ] **Step 5: Sanity-check the compose file parses**

Run: `cd /Users/kaellim/Desktop/projects/library/supabase-docker && docker compose config --services 2>&1 | head -5`
Expected: prints the service list including `worker`, no YAML error. If `docker compose` is not available locally, run:

```bash
python3 -c "import yaml; yaml.safe_load(open('/Users/kaellim/Desktop/projects/library/supabase-docker/docker-compose.yml'))"
```

Expected: no output (successful parse).

- [ ] **Step 6: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git add worker/.env.example supabase-docker/docker-compose.yml
git commit -m "$(cat <<'EOF'
chore(env): forward ALLOWED_PDF_HOSTS to worker container

Documents the new env var in worker/.env.example and passes it through
docker-compose so the upcoming /books/r/ext handler can read it at boot.
EOF
)"
```

---

## Task 3: `GET /books/r/ext` handler in `server.ts`

**Files:**
- Modify: `worker/src/server.ts` — import validator, cache `ALLOWED_PDF_HOSTS` at module scope, register the new route **before** the existing `/books/r/*` wildcard.

**Interfaces:**
- Consumes:
  - `validatePdfUrl`, `parseAllowedHosts` from `./services/pdf-url-validator.js` (Task 1).
  - `bookTemplate`, `escapeHtml`, `escapeAttr`, `safeJsonForScript` — already defined in `server.ts`.
  - `process.env.ALLOWED_PDF_HOSTS` (Task 2).
- Produces: `GET /books/r/ext` returning `text/html`, or a JSON `{ error, message }` with HTTP 400 for any validation failure.

- [ ] **Step 1: Add the import and cached allowlist near the top of `server.ts`**

Read `worker/src/server.ts`. Find the existing block of imports at the top (currently ending with `import { requireAuth } from './middleware/auth.js';`). **Add one new import line right after it**:

```ts
import { validatePdfUrl, parseAllowedHosts } from './services/pdf-url-validator.js';
```

Then find the existing constant `const BOOKS_DIR = process.env.BOOKS_DIR || …` (currently around line 81). **Immediately after that line**, add:

```ts
const ALLOWED_PDF_HOSTS = parseAllowedHosts(process.env.ALLOWED_PDF_HOSTS);
```

- [ ] **Step 2: Register the new handler _before_ the existing `/books/r/*` wildcard**

Find the existing route block that begins with:

```ts
fastify.get<{
  Params: { '*': string };
}>('/books/r/*', async (request, reply) => {
```

**Insert the new handler immediately above it.** Paste this code verbatim:

```ts
// External-PDF viewer: renders the same flip-book template for any HTTPS PDF
// on the ALLOWED_PDF_HOSTS allowlist. Query params supply the URL and optional
// OG meta. PDF.js in the browser is the only entity that fetches the PDF,
// so the worker has no outbound HTTP surface.
// Spec: docs/superpowers/specs/2026-07-03-external-pdf-reader-design.md
fastify.get<{
  Querystring: Record<string, unknown>;
}>('/books/r/ext', async (request, reply) => {
  const q = request.query;

  const pickString = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : undefined;

  const src   = pickString(q.src);
  const cover = pickString(q.cover);
  const title = pickString(q.title)  ?? '';
  const desc  = pickString(q.desc)   ?? '';
  const author= pickString(q.author) ?? '';
  const turn  = pickString(q.turn);

  // ?src=a&src=b arrives as string[]; pickString returns undefined for that.
  if (src === undefined && q.src !== undefined) {
    return reply.status(400).send({ error: 'INVALID_SRC', message: '缺少 src 參數' });
  }

  const srcCheck = validatePdfUrl(src, ALLOWED_PDF_HOSTS);
  if (!srcCheck.ok) {
    const msg: Record<string, string> = {
      MISSING_SRC:      '缺少 src 參數',
      URL_TOO_LONG:     'src 超過 2048 字元',
      INVALID_URL:      'src 不是有效 URL',
      INVALID_SCHEME:   'src 必須使用 https',
      HOST_NOT_ALLOWED: 'src 網域不在白名單',
    };
    return reply.status(400).send({
      error: srcCheck.error,
      message: msg[srcCheck.error] ?? 'src 不合法',
    });
  }

  // Empty cover string (?cover=) is fine — just leaves og:image empty.
  if (cover !== undefined && cover !== '') {
    const coverCheck = validatePdfUrl(cover, ALLOWED_PDF_HOSTS);
    if (!coverCheck.ok) {
      return reply.status(400).send({
        error: 'INVALID_COVER_URL',
        message: 'cover 網址不合法',
      });
    }
  }

  const viewerConfig = {
    pdf: src,
    turnPage: turn === 'left' ? 'left' : 'right',
    analytics: {
      trackPageFlip: true,
      trackZoom: true,
      trackNavigation: true,
      trackShare: true,
      trackFullscreen: true,
      trackReadingTime: true,
    },
  };

  if (!bookTemplate) {
    return reply.status(500).send({ error: 'Reader template not found' });
  }

  const injectedHtml = bookTemplate
    .replace(
      '<title>PDF Page Flip Demo</title>',
      `<title>${escapeHtml(title || 'PDF Reader')}</title>
    <meta property="og:title" content="${escapeAttr(title)}" />
    <meta property="og:description" content="${escapeAttr(desc)}" />
    <meta property="og:image" content="${escapeAttr(cover ?? '')}" />
    <meta property="og:type" content="book" />
    <meta property="book:author" content="${escapeAttr(author)}" />
    <meta name="description" content="${escapeAttr(desc)}" />`
    )
    .replace(
      /<script id="viewer-config" type="application\/json">[\s\S]*?<\/script>/,
      `<script id="viewer-config" type="application/json">${safeJsonForScript(viewerConfig)}</script>`
    );

  return reply.type('text/html').send(injectedHtml);
});
```

Note on Fastify route ordering: Fastify's radix-tree router matches static
segments (`ext`) before wildcard segments (`*`), so putting this handler
above the wildcard is a style choice, not a correctness one — but it keeps
the file readable.

- [ ] **Step 3: Type-check**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npx tsc --noEmit`
Expected: no output (success).

- [ ] **Step 4: Re-run the whole worker test suite**

Run: `cd /Users/kaellim/Desktop/projects/library/worker && npm test`
Expected: all previously passing tests still pass; 5 new tests from Task 1 also pass. Some `process.exit unexpectedly called` errors from the pre-existing `server.ts` import at test time are known and harmless — do not chase them.

- [ ] **Step 5: Local smoke test (recommended)**

Start the worker in one shell:

```bash
cd /Users/kaellim/Desktop/projects/library/worker
ALLOWED_PDF_HOSTS=tool.tzuchi-org.tw npm run dev
```

In a second shell, hit the endpoint against a known PDF URL and inspect the response body's `<script id="viewer-config">` and `<title>`:

```bash
curl -s "http://localhost:3001/books/r/ext?src=https%3A%2F%2Ftool.tzuchi-org.tw%2Fsample.pdf&title=%E6%B8%AC%E8%A9%A6&turn=left" | grep -E '<title>|viewer-config'
```

Expected: `<title>測試</title>` (with your text) and a `viewer-config` line whose JSON contains `"pdf":"https://tool.tzuchi-org.tw/sample.pdf"` and `"turnPage":"left"`.

Then a rejection case:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3001/books/r/ext?src=https%3A%2F%2Fevil.com%2Ffoo.pdf"
```

Expected: `400`. Body: `{"error":"HOST_NOT_ALLOWED","message":"src 網域不在白名單"}`.

Stop the dev server (Ctrl-C).

- [ ] **Step 6: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git add worker/src/server.ts
git commit -m "$(cat <<'EOF'
feat(reader): add /books/r/ext handler for external PDFs

New GET /books/r/ext takes ?src=<https-url>&[title|desc|cover|author]=…
&[turn=left|right] and renders the existing flip-book template. The
worker never fetches the PDF — PDF.js does that from the browser — so
there is no server-side outbound HTTP surface. src (and cover, if given)
are validated against the ALLOWED_PDF_HOSTS allowlist parsed once at
boot. Every text value passes through the existing escapeHtml /
escapeAttr / safeJsonForScript helpers before entering the template.
EOF
)"
```

---

## Task 4: Documentation update — `worker/CLAUDE.md`

**Files:**
- Modify: `worker/CLAUDE.md` — add a subsection under the Book Reader section describing the new route and its env var.

**Interfaces:**
- Consumes: nothing.
- Produces: reference documentation only.

- [ ] **Step 1: Read the current file to find the Book Reader / Routes section**

Read `/Users/kaellim/Desktop/projects/library/worker/CLAUDE.md`. Find whichever section documents the existing `/books/r/{uuid}` route (may be titled `Book Reader`, `Routes`, or similar). If the file has no such section, add the new documentation immediately after the `<claude-mem-context>` block.

- [ ] **Step 2: Insert this block**

```markdown
## External PDF Reader

`GET /books/r/ext?src=<encoded https URL>` renders the flip-book viewer
for any PDF whose host is on the `ALLOWED_PDF_HOSTS` allowlist.

- `src` (required) — URL-encoded HTTPS URL; host must match one of the
  entries in `ALLOWED_PDF_HOSTS` exactly (no subdomain wildcards).
- `title`, `desc`, `cover`, `author` — optional plain-text / URL OG meta;
  `cover` runs through the same allowlist validation as `src`.
- `turn=left|right` — flip direction; default `right` (LTR).

`ALLOWED_PDF_HOSTS` is a comma-separated list of hostnames read from the
env at boot (e.g. `tool.tzuchi-org.tw,another.tzuchi-org.tw`). Empty ⇒
every request returns `HOST_NOT_ALLOWED`.

Full spec: `docs/superpowers/specs/2026-07-03-external-pdf-reader-design.md`.
```

- [ ] **Step 3: Commit**

```bash
cd /Users/kaellim/Desktop/projects/library
git add worker/CLAUDE.md
git commit -m "docs(worker): document /books/r/ext external-PDF reader"
```

---

## Task 5: Manual e2e + rollout checklist

**Files:** none — this is a rollout gate, not a code change.

**Interfaces:**
- Consumes: Tasks 1–4 already committed and pushed.

- [ ] **Step 1: Push all commits to `origin/main`**

```bash
cd /Users/kaellim/Desktop/projects/library
git push origin main
```

- [ ] **Step 2: Deploy the worker to production**

```bash
ssh kaelsohappy1@192.168.2.235 'cd ~/library && git pull && cd supabase-docker && docker compose up -d --build worker'
```

- [ ] **Step 3: Verify the env var is set on the host**

Add `ALLOWED_PDF_HOSTS=tool.tzuchi-org.tw` to whichever `.env` file the production docker-compose reads from (typically `supabase-docker/.env`) if it is not there already, then re-`docker compose up -d worker` to pick it up. Confirm inside the container:

```bash
ssh kaelsohappy1@192.168.2.235 'sudo docker compose -f ~/library/supabase-docker/docker-compose.yml exec worker printenv ALLOWED_PDF_HOSTS'
```

Expected: prints `tool.tzuchi-org.tw`. (Using `printenv` avoids shell-quote expansion happening on the ssh host instead of inside the container.)

- [ ] **Step 4: Manual acceptance tests (browser)**

Coordinate with the `tool.tzuchi-org.tw` owner to confirm their PDFs respond with the CORS headers listed in spec §11. Then open:

1. `https://librarypj.tzuchi-org.tw/books/r/ext?src=https%3A%2F%2Ftool.tzuchi-org.tw%2Ftest.pdf&title=%E6%B8%AC%E8%A9%A6&turn=left` — viewer loads, tab title `測試`, right-to-left flip.
2. Same URL with `&turn=right` — left-to-right flip.
3. Same URL without `turn` — defaults right (LTR).
4. Replace `src` host with `https://evil.example/x.pdf` — 400 JSON body `{"error":"HOST_NOT_ALLOWED","message":"src 網域不在白名單"}`.
5. Replace `src` scheme with `http://tool.tzuchi-org.tw/x.pdf` (still URL-encoded) — 400 `INVALID_SCHEME`.
6. Omit `src` entirely (`/books/r/ext`) — 400 `MISSING_SRC`.
7. Duplicate `src` (`?src=a&src=b`) — 400 `INVALID_SRC`.

If any check fails, roll back with `git revert <commit> && docker compose up -d --build worker` and file the follow-up.

- [ ] **Step 5: Notify the caller team**

Send the `tool.tzuchi-org.tw` maintainers:
- The URL template: `https://librarypj.tzuchi-org.tw/books/r/ext?src=<URL-encoded PDF URL>&title=&desc=&cover=&author=&turn=left|right`.
- The CORS/Range headers they must serve (spec §11).
- The 400 error codes they might see (spec §9).

Rollout is complete once step 4 passes end-to-end from at least one non-local browser.

---

## Spec Coverage Cross-Check

| Spec section | Task |
|---|---|
| §1 Goal | Task 3 handler |
| §2 Non-Goals | Enforced by omission across all tasks |
| §3 URL Contract | Task 3 handler + Task 1 validator |
| §4 Architecture | Task 3 handler |
| §5 Components (validator) | Task 1 |
| §5 Components (server.ts) | Task 3 |
| §5 Components (env / compose) | Task 2 |
| §5 Components (docs) | Task 4 |
| §5 Components (tests) | Task 1 |
| §6 Validator rules | Task 1 tests + implementation |
| §7 Handler flow | Task 3 |
| §8 Environment | Task 2 + Task 3 (module-scope cache) |
| §9 Error responses | Task 3 (message table) |
| §10 Unit tests | Task 1 |
| §10 Manual e2e | Task 5 |
| §11 External CORS | Task 5 step 5 notification |
| §12 Security posture | Enforced by Task 1 + Task 3 |
| §13 Rollout | Task 5 |
