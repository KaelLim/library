# External PDF Reader — Design Spec

**Date:** 2026-07-03
**Author:** Kael Lim (with Claude Opus 4.7)
**Status:** Approved — ready for implementation plan

## 1. Goal

Extend the flip-book viewer at `librarypj.tzuchi-org.tw` so a caller from
a trusted allowlisted host (initially `tool.tzuchi-org.tw`) can render any
of their own PDFs by passing the PDF URL as a query parameter — reusing
the exact same viewer, template, and analytics wiring that
`/books/r/{uuid}` uses today.

## 2. Non-Goals

- ❌ Server-side PDF proxy. All PDF fetching stays client-side via
  PDF.js so worker never touches an outbound HTTP request → no SSRF surface.
- ❌ Hit counter. There is no `books` row to attribute reads to.
- ❌ Per-URL rate limiting. The global 100/min ceiling is sufficient for
  reads of an allowlisted host.
- ❌ `HEAD` probe for `Content-Type: application/pdf`. Trust is derived
  from the host allowlist, not content sniffing.
- ❌ Subdomain wildcard matching. Every allowed host is spelled out to
  eliminate `evil.attacker.tool.tzuchi-org.tw` bypasses.
- ❌ Dashboard UI that constructs these links. The consumer
  (`tool.tzuchi-org.tw`) generates the reader URLs itself.
- ❌ Any change to Kong, `books/index.html`, `books/src/app.ts`, or the
  DB schema.

## 3. URL Contract

```
GET /books/r/ext?src=<encoded-url>
                 [&title=<t>]
                 [&desc=<d>]
                 [&cover=<img-url>]
                 [&author=<a>]
                 [&turn=left|right]
```

- `src` — **required**, URL-encoded (percent-encoded) HTTPS URL of the
  target PDF.
- `title` — optional, plain text; falls back to empty string.
- `desc` — optional, plain text; used for `og:description` and
  `<meta name=description>`.
- `cover` — optional, URL-encoded HTTPS URL used for `og:image`. Must
  pass the same host-allowlist validation as `src`.
- `author` — optional, plain text; used for `book:author`.
- `turn` — optional; `left` = 中文右翻左 RTL, `right` = 英文左翻右 LTR.
  Any other value (or missing) defaults to `right`.

All query values arrive as `string | string[] | undefined` from Fastify.
Any parameter received as an array (`?src=a&src=b`) is rejected.

## 4. Architecture

New worker route `GET /books/r/ext`. **Does not query the DB.** Builds
`viewerConfig` directly from validated query parameters, then reuses the
existing `bookTemplate`, `escapeHtml`, `escapeAttr`, and
`safeJsonForScript` helpers from `worker/src/server.ts` to inject the
config and OG meta.

PDF.js in the browser fetches the external PDF **directly** from the
allowlisted host. The worker never sees the PDF bytes.

```
Browser                  Worker                    tool.tzuchi-org.tw
   │                        │                              │
   │─── GET /books/r/ext ──▶│                              │
   │      ?src=...&title=…  │                              │
   │                        │─ validatePdfUrl(src, hosts)  │
   │                        │─ build viewerConfig          │
   │                        │─ inject bookTemplate         │
   │◀────── 200 HTML ───────│                              │
   │                                                        │
   │────── load app.js → PDF.js.getDocument({url}) ────────▶│
   │◀───── PDF chunks (Range + CORS) ──────────────────────│
   │                                                        │
   │─ render pages to canvas → StPageFlip animates ─┐      │
```

## 5. Components

| File | Action | Responsibility |
|------|--------|----------------|
| `worker/src/services/pdf-url-validator.ts` | **create** | Pure function: `validatePdfUrl(src, allowedHosts): Ok \| Err` |
| `worker/src/server.ts` | **modify** | Register `GET /books/r/ext` handler; add `parseAllowedHosts()` reading `ALLOWED_PDF_HOSTS` env once at boot |
| `worker/.env.example` | **modify** | Document `ALLOWED_PDF_HOSTS=tool.tzuchi-org.tw` |
| `supabase-docker/docker-compose.yml` | **modify** | Pass `ALLOWED_PDF_HOSTS` through to the worker service |
| `worker/CLAUDE.md` | **modify** | Document the new `/books/r/ext` route in the Book Reader section |
| `worker/tests/services/pdf-url-validator.test.ts` | **create** | Unit tests covering the full validation matrix |

**Reused, untouched:** `bookTemplate` loaded at boot, `escapeHtml`,
`escapeAttr`, `safeJsonForScript`, `STATIC_EXTENSIONS`, all Kong routing,
`books/index.html`, `books/src/app.ts`.

## 6. `validatePdfUrl` Behavior

**Signature:**

```typescript
export type PdfUrlOk = { ok: true; url: URL };
export type PdfUrlErr = { ok: false; error: PdfUrlError };
export type PdfUrlError =
  | 'MISSING_SRC'
  | 'INVALID_SRC'
  | 'INVALID_URL'
  | 'INVALID_SCHEME'
  | 'USERINFO_NOT_ALLOWED'
  | 'IP_HOST_NOT_ALLOWED'
  | 'HOST_NOT_ALLOWED'
  | 'URL_TOO_LONG';

export function validatePdfUrl(
  src: string | undefined,
  allowedHosts: readonly string[],
): PdfUrlOk | PdfUrlErr;
```

**Rules, applied in order** (first failure wins):

1. `src` is undefined or empty → `MISSING_SRC`.
2. `src.length > 2048` → `URL_TOO_LONG`.
3. `new URL(src)` throws → `INVALID_URL`.
4. `url.protocol !== 'https:'` → `INVALID_SCHEME`.
5. `url.username !== '' || url.password !== ''` → `USERINFO_NOT_ALLOWED`.
6. `url.hostname` matches an IPv4 dotted-quad regex or contains `:`
   (IPv6, brackets stripped by the URL parser) → `IP_HOST_NOT_ALLOWED`.
7. `url.hostname` (lowercased) is not `===` to any entry of
   `allowedHosts` → `HOST_NOT_ALLOWED`.
8. Otherwise → `{ ok: true, url }`.

Rules 5, 6 have their own distinct error codes (not a shared
`INVALID_URL`) so the handler in §9 can surface actionable messages.

The function is pure, does no DNS lookup, does no network I/O.

`allowedHosts` entries are trimmed, lowercased, and empty entries removed
before comparison (this is the caller's job — `parseAllowedHosts` in
`server.ts` — so the validator itself takes a clean list).

## 7. Handler Flow

```typescript
// pseudo
async (request, reply) => {
  const q = request.query as Record<string, unknown>;

  const src   = pickString(q.src);
  const cover = pickString(q.cover);
  const title = pickString(q.title) ?? '';
  const desc  = pickString(q.desc)  ?? '';
  const author= pickString(q.author) ?? '';
  const turn  = pickString(q.turn);

  // pickString returns undefined if array or non-string

  if (src === undefined) return reply.status(400).send({ error: 'INVALID_SRC', ... });
  const srcCheck = validatePdfUrl(src, ALLOWED_PDF_HOSTS);
  if (!srcCheck.ok) return reply.status(400).send({ error: srcCheck.error, ... });

  if (cover !== undefined && cover !== '') {
    const coverCheck = validatePdfUrl(cover, ALLOWED_PDF_HOSTS);
    if (!coverCheck.ok) return reply.status(400).send({
      error: 'INVALID_COVER_URL',
      message: '<see §9>',
    });
  }
  // cover === '' or undefined → og:image just empty; no validation error.

  const viewerConfig = {
    pdf: src,
    turnPage: turn === 'left' ? 'left' : 'right',   // default right
    analytics: {
      trackPageFlip: true, trackZoom: true, trackNavigation: true,
      trackShare: true, trackFullscreen: true, trackReadingTime: true,
    },
  };

  const injectedHtml = bookTemplate
    .replace(
      '<title>PDF Page Flip Demo</title>',
      `<title>${escapeHtml(title || 'PDF Reader')}</title>
    <meta property="og:title" content="${escapeAttr(title)}" />
    <meta property="og:description" content="${escapeAttr(desc)}" />
    <meta property="og:image" content="${escapeAttr(cover ?? '')}" />
    <meta property="og:type" content="book" />
    <meta property="book:author" content="${escapeAttr(author)}" />
    <meta name="description" content="${escapeAttr(desc)}" />`,
    )
    .replace(
      /<script id="viewer-config" type="application\/json">[\s\S]*?<\/script>/,
      `<script id="viewer-config" type="application/json">${safeJsonForScript(viewerConfig)}</script>`,
    );

  return reply.type('text/html').send(injectedHtml);
};
```

`pickString(v)` returns `undefined` if `v` is not a `string`; this
rejects `?src=a&src=b` (which arrives as `string[]`) upfront.

Where the existing `/books/r/{uuid}` fills OG meta from the DB row, this
route fills them from query parameters — defaulting to empty. `<title>`
falls back to the literal string `PDF Reader` when `title` is empty so
the browser tab is not blank.

## 8. Environment

```bash
# worker/.env
ALLOWED_PDF_HOSTS=tool.tzuchi-org.tw
```

- Comma-separated list, whitespace trimmed, lowercased, empty entries
  dropped.
- Unset or empty ⇒ every `src` returns `HOST_NOT_ALLOWED`. **No
  fail-open** default.
- Parsed **once at boot** into `const ALLOWED_PDF_HOSTS = parseAllowedHosts(process.env.ALLOWED_PDF_HOSTS)`.
- `supabase-docker/docker-compose.yml` forwards the var into the worker
  container the same way it forwards `SUPABASE_URL` etc.

## 9. Errors — Response Shape

All 400s use the existing Fastify error shape:

```json
{ "error": "<CODE>", "message": "<human-readable Traditional Chinese>" }
```

| Case | `error` | `message` |
|------|--------|-----------|
| `src` missing / empty | `MISSING_SRC` | `缺少 src 參數` |
| `src` sent as array (`?src=a&src=b`) | `INVALID_SRC` | `缺少 src 參數` |
| URL too long (> 2048) | `URL_TOO_LONG` | `src 超過 2048 字元` |
| URL parse fails | `INVALID_URL` | `src 不是有效 URL` |
| Non-https scheme | `INVALID_SCHEME` | `src 必須使用 https` |
| userinfo present | `USERINFO_NOT_ALLOWED` | `src 不接受帳號密碼` |
| Host is IP (v4 or v6) | `IP_HOST_NOT_ALLOWED` | `src 不接受 IP 位址` |
| Host not on allowlist | `HOST_NOT_ALLOWED` | `src 網域不在白名單` |
| Cover URL fails **any** validation rule | `INVALID_COVER_URL` | `cover 網址不合法` |
| Cover value is empty string | *(no error)* | (og:image left empty) |

## 10. Testing

### Unit — `pdf-url-validator.test.ts`

Cover every rule in §6 exactly once, then a happy path:

1. `undefined` src → `MISSING_SRC`
2. `''` src → `MISSING_SRC`
3. `'x'.repeat(2049)` → `URL_TOO_LONG`
4. `'not a url'` → `INVALID_URL`
5. `'http://tool.tzuchi-org.tw/a.pdf'` → `INVALID_SCHEME`
6. `'ftp://tool.tzuchi-org.tw/a.pdf'` → `INVALID_SCHEME`
7. `'https://user:pass@tool.tzuchi-org.tw/a.pdf'` → `USERINFO_NOT_ALLOWED`
8. `'https://127.0.0.1/a.pdf'` → `IP_HOST_NOT_ALLOWED`
9. `'https://192.168.0.5/a.pdf'` → `IP_HOST_NOT_ALLOWED`
10. `'https://[::1]/a.pdf'` → `IP_HOST_NOT_ALLOWED`
11. `'https://evil.com/a.pdf'` with allowlist `['tool.tzuchi-org.tw']` → `HOST_NOT_ALLOWED`
12. `'https://evil.tool.tzuchi-org.tw/a.pdf'` (subdomain injection) → `HOST_NOT_ALLOWED`
13. `'https://tool.tzuchi-org.tw.evil.com/a.pdf'` (suffix injection) → `HOST_NOT_ALLOWED`
14. `'https://Tool.Tzuchi-Org.Tw/a.pdf'` with allowlist `['tool.tzuchi-org.tw']` → **ok** (case-insensitive host comparison per WHATWG URL spec: `hostname` is already lowercased by the URL parser)
15. `'https://tool.tzuchi-org.tw/a.pdf'` → ok, returned URL preserves original path/query
16. `'https://tool.tzuchi-org.tw/a.pdf?token=abc&x=1'` → ok, query preserved
17. Empty `allowedHosts` `[]` → `HOST_NOT_ALLOWED` for any valid https URL

### Unit — `parseAllowedHosts` (inline in server.ts, tested via export)

Test that `parseAllowedHosts('  tool.tzuchi-org.tw , Foo.Bar , ,x  ')`
returns `['tool.tzuchi-org.tw', 'foo.bar', 'x']`, and
`parseAllowedHosts('')` returns `[]`, and
`parseAllowedHosts(undefined)` returns `[]`.

### Manual e2e (after deploy)

- Put a test PDF at `https://tool.tzuchi-org.tw/test-reader.pdf`.
- Open `https://librarypj.tzuchi-org.tw/books/r/ext?src=https%3A%2F%2Ftool.tzuchi-org.tw%2Ftest-reader.pdf&title=%E6%B8%AC%E8%A9%A6&turn=left`.
- Expect: browser tab title `測試`, viewer loads, page flips right-to-left.
- Change `turn=right` — flips left-to-right.
- Remove `turn` — defaults right (left-to-right).
- Point `src` at `https://evil.com/x.pdf` — expect HTTP 400
  `HOST_NOT_ALLOWED` JSON payload.
- Point `src` at `http://tool.tzuchi-org.tw/x.pdf` — expect 400
  `INVALID_SCHEME`.

### Explicitly not tested here

- Whether `tool.tzuchi-org.tw` actually returns proper CORS + Range
  headers. That is an external dependency (see §11) and manual e2e will
  fail if it isn't set up, but our route handler itself will return 200
  successfully — the failure surfaces in the browser console.

## 11. External Dependencies

`tool.tzuchi-org.tw` must serve PDFs with:

```
Access-Control-Allow-Origin: https://librarypj.tzuchi-org.tw
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Access-Control-Allow-Headers: Range, If-Range
Access-Control-Expose-Headers: Accept-Ranges, Content-Range, Content-Length, ETag
Accept-Ranges: bytes
```

Without these, PDF.js will fail with a CORS error and the viewer will
show a blank page. The code has no automatic fallback for HTTPS
sources — the existing `corsproxy.io` fallback in `books/src/app.ts:249`
only fires for `http://` URLs (which are already rejected server-side).

## 12. Security Posture

Threats addressed by this design (all validated in §6):

- **Open redirect / phishing under `librarypj.tzuchi-org.tw`** — blocked
  by host allowlist. Only PDFs from operator-controlled hosts render.
- **XSS via query parameters** — every value passes through the existing
  `escapeHtml` / `escapeAttr` / `safeJsonForScript` helpers before
  reaching HTML or JSON.
- **SSRF** — worker never fetches the URL; there is no server-side
  outbound HTTP.
- **`javascript:` / `data:` / `file:` schemes** — rejected by
  `INVALID_SCHEME`.
- **DNS-rebinding / private-IP targets** — irrelevant to the worker
  (no server fetch) and further blocked by the IPv4/IPv6 hostname check.
- **Free-CDN abuse** — global 100/min rate limit still applies; response
  is a small HTML page (not the PDF), so bandwidth cost is negligible.
- **Subdomain injection** — validator requires exact hostname equality;
  `evil.tool.tzuchi-org.tw` does not match `tool.tzuchi-org.tw`.
- **Suffix injection** — validator requires exact hostname equality;
  `tool.tzuchi-org.tw.evil.com` does not match.
- **Cover-URL abuse** — the `cover` parameter is validated with the same
  allowlist so an attacker cannot smuggle a tracking pixel through
  `og:image`.

Threats explicitly accepted:

- **CSP is still disabled on the server** (`helmet contentSecurityPolicy: false`
  in `server.ts:32`) — hardening CSP is out of scope for this spec.
  The `books/index.html` meta CSP already restricts `connect-src` to
  `'self' https: data:`, which is enforced by the browser.
- **The reader URL is bookmarkable and shareable.** Anyone who receives
  it can open it; there is no per-URL access control.

## 13. Rollout

1. Land the code change on `main`, run `npm test` in `worker/`.
2. Set `ALLOWED_PDF_HOSTS=tool.tzuchi-org.tw` in production `.env` (or
   `docker-compose.yml`).
3. `git pull && docker compose up -d --build worker` on the production
   host.
4. Manual e2e as in §10.
5. Notify `tool.tzuchi-org.tw` maintainers of the CORS requirements
   from §11.

Rollback: revert the commit, redeploy. There is no DB migration and no
persisted state, so rollback is instant.
