import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertNoLegacyFiles,
  assertNoSecrets,
  assertPublicSkill,
  assertSourceVersions,
  filesUnder
} from '../../../scripts/release-guard.mjs';

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(skillRoot, '../..');

function withTemp(prefix, callback) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('公开 Skill 文案通过产品化检查', () => {
  assert.doesNotThrow(() => assertPublicSkill(join(skillRoot, 'SKILL.md')));
});

test('公开 Skill 混入命令或开发术语时拒绝发布', () => withTemp('release-public-copy-', (directory) => {
  const target = join(directory, 'SKILL.md');
  copyFileSync(join(skillRoot, 'SKILL.md'), target);
  writeFileSync(target, '\n```bash\nnode scripts/example.mjs\n```\n', { flag: 'a' });
  assert.throws(() => assertPublicSkill(target), /公开正文含技术内容/);
}));

test('发布目录混入日报或对账脚本时拒绝发布', () => withTemp('release-legacy-', (directory) => {
  mkdirSync(join(directory, 'scripts'));
  writeFileSync(join(directory, 'scripts/daily-report-core.mjs'), 'export default true;\n');
  assert.throws(() => assertNoLegacyFiles(directory), /旧功能文件/);
}));

test('发布目录混入敏感信息时拒绝发布', () => withTemp('release-secret-', (directory) => {
  writeFileSync(join(directory, 'leak.txt'), 'Authorization: Bearer example-secret-token-value\n');
  assert.throws(() => assertNoSecrets(directory), /敏感信息/);
}));

test('发布目录混入符号链接时拒绝发布', () => withTemp('release-symlink-', (directory) => {
  const outside = join(directory, 'outside.txt');
  writeFileSync(outside, 'outside\n');
  const packageDir = join(directory, 'package');
  mkdirSync(packageDir);
  symlinkSync(outside, join(packageDir, 'linked.txt'));
  assert.throws(() => filesUnder(packageDir), /符号链接/);
}));

test('源码中 Skill、锁文件和 WorkBuddy 版本号一致', () => {
  assert.equal(assertSourceVersions(projectRoot), '1.5.1');
});
