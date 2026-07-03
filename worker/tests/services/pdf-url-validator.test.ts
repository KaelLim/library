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
