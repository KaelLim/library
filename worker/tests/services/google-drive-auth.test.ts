import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseServiceAccountKey,
  readRawServiceAccountKey,
} from '../../src/services/google-drive-auth.js';

const VALID_KEY = JSON.stringify({
  type: 'service_account',
  project_id: 'tzuchi-weekly-15d53',
  client_email: 'driveapi@tzuchi-weekly-15d53.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nXXX\n-----END PRIVATE KEY-----\n',
});

describe('parseServiceAccountKey', () => {
  it('parses a valid service account JSON string', () => {
    const key = parseServiceAccountKey(VALID_KEY);
    expect(key?.client_email).toBe(
      'driveapi@tzuchi-weekly-15d53.iam.gserviceaccount.com'
    );
    expect(key?.private_key).toContain('BEGIN PRIVATE KEY');
  });

  it('returns null when client_email is missing', () => {
    const raw = JSON.stringify({ private_key: 'x' });
    expect(parseServiceAccountKey(raw)).toBeNull();
  });

  it('returns null when private_key is missing', () => {
    const raw = JSON.stringify({ client_email: 'a@b.com' });
    expect(parseServiceAccountKey(raw)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseServiceAccountKey('{not json')).toBeNull();
  });

  it('returns null for null/empty input', () => {
    expect(parseServiceAccountKey(null)).toBeNull();
    expect(parseServiceAccountKey('')).toBeNull();
  });
});

describe('readRawServiceAccountKey', () => {
  let dir: string;
  const saveFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  const saveJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sa-test-'));
    delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (saveFile === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    else process.env.GOOGLE_SERVICE_ACCOUNT_FILE = saveFile;
    if (saveJson === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = saveJson;
  });

  it('reads from the file when GOOGLE_SERVICE_ACCOUNT_FILE is set', () => {
    const path = join(dir, 'key.json');
    writeFileSync(path, VALID_KEY);
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE = path;
    expect(readRawServiceAccountKey()).toBe(VALID_KEY);
  });

  it('prefers the file over the GOOGLE_SERVICE_ACCOUNT_JSON env string', () => {
    const path = join(dir, 'key.json');
    writeFileSync(path, VALID_KEY);
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE = path;
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"from":"env"}';
    expect(readRawServiceAccountKey()).toBe(VALID_KEY);
  });

  it('falls back to GOOGLE_SERVICE_ACCOUNT_JSON when file env is unset', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = VALID_KEY;
    expect(readRawServiceAccountKey()).toBe(VALID_KEY);
  });

  it('returns null when neither source is configured', () => {
    expect(readRawServiceAccountKey()).toBeNull();
  });

  it('returns null when the file path is set but the file is unreadable', () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_FILE = join(dir, 'does-not-exist.json');
    expect(readRawServiceAccountKey()).toBeNull();
  });
});
