import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSafeFileReader, createSensitivePathMatcher, normalizeRelativePath } from '../src/filesystem/safe-reader.js';
import { createRedactor } from '../src/redaction.js';
import { makeTempDir } from './helpers/repos.js';

test('normalizeRelativePath blocks traversal and option injection', () => {
  assert.throws(() => normalizeRelativePath('../secret.txt'), { code: 'E_PATH_INVALID' });
  assert.throws(() => normalizeRelativePath('-n'), { code: 'E_PATH_INVALID' });
});

test('sensitive path matcher blocks secret-like files', () => {
  const matcher = createSensitivePathMatcher();
  assert.equal(matcher.isSensitive('.env'), true);
  assert.equal(matcher.isSensitive('src/app.vb'), false);
});

test(
  'safe reader rejects symlink escapes and redacts content',
  { skip: process.platform === 'win32' },
  async () => {
    const root = await makeTempDir('safe-reader-');
    const outside = await makeTempDir('safe-reader-outside-');
    await writeFile(join(outside, 'secret.txt'), '******');
    await mkdir(join(root, 'src'), { recursive: true });
    await symlink(join(outside, 'secret.txt'), join(root, 'src', 'link.txt'));

    const reader = createSafeFileReader({
      redactor: createRedactor(),
      sensitivePathMatcher: createSensitivePathMatcher(),
    });

    await assert.rejects(
      () => reader.readBoundedText({ rootPath: root, relativePath: 'src/link.txt', maxBytes: 100 }),
      { code: 'E_SYMLINK_BLOCKED' }
    );
  }
);

test('safe reader redacts content and blocks sensitive paths', async () => {
  const root = await makeTempDir('safe-reader-');
  await writeFile(join(root, 'visible.vb'), 'user id=alice');
  await writeFile(join(root, '.env'), 'DB_PASSWORD=secret');

  const reader = createSafeFileReader({
    redactor: createRedactor(),
    sensitivePathMatcher: createSensitivePathMatcher(),
  });

  const result = await reader.readBoundedText({ rootPath: root, relativePath: 'visible.vb', maxBytes: 200 });
  assert.match(result.content, /\[REDACTED_FIELD\]/);
  await assert.rejects(() => reader.readBoundedText({ rootPath: root, relativePath: '.env', maxBytes: 200 }), {
    code: 'E_SENSITIVE_PATH',
  });
});
