// Pure validator + env parser for the /books/r/ext external-PDF reader.
// No I/O, no DNS, no env access. See docs/superpowers/specs/2026-07-03-external-pdf-reader-design.md

export type PdfUrlError =
  | 'MISSING_SRC'
  | 'INVALID_SRC'
  | 'INVALID_URL'
  | 'INVALID_SCHEME'
  | 'USERINFO_NOT_ALLOWED'
  | 'IP_HOST_NOT_ALLOWED'
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
  if (url.username !== '' || url.password !== '') return { ok: false, error: 'USERINFO_NOT_ALLOWED' };
  if (isIpHost(url.hostname)) return { ok: false, error: 'IP_HOST_NOT_ALLOWED' };

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
