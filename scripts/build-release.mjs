#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertNoLegacyFiles,
  assertNoSecrets,
  assertPublicSkill,
  assertRuntimeParity,
  assertSourceVersions,
  manifestFor,
  sha256
} from './release-guard.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetArg = process.argv[2];
if (!targetArg || !isAbsolute(targetArg)) throw new Error('请提供一个不存在的绝对目录作为交付位置');
const target = resolve(targetArg);
if (target === projectRoot || target === dirname(projectRoot) || basename(target) === '') throw new Error('交付位置不安全');
if (existsSync(target)) throw new Error('交付位置必须尚未创建');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error?.message || '').trim();
    throw new Error(`${command} 执行失败${detail ? `：${detail}` : ''}`);
  }
  return result.stdout;
}

function zipDirectory(source, output, { includeRoot }) {
  if (includeRoot) {
    run('zip', ['-X', '-q', '-r', output, basename(source)], { cwd: dirname(source) });
  } else {
    run('zip', ['-X', '-q', '-r', output, '.'], { cwd: source });
  }
  if (!existsSync(output) || lstatSync(output).size === 0) throw new Error(`ZIP 生成失败：${output}`);
}

function assertCleanWorktree() {
  const status = run('git', ['status', '--porcelain']).trim();
  if (status) throw new Error('工作区存在未提交变更，拒绝生成正式包');
  return run('git', ['rev-parse', 'HEAD']).trim();
}

function assertZipListing(zip, { skillHub }) {
  const listing = run('unzip', ['-Z1', zip], { cwd: projectRoot })
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
  if (listing.some((path) => /daily-report|customer-statement|reconcile-and-export/i.test(path))) {
    throw new Error(`ZIP 包含已移除功能：${basename(zip)}`);
  }
  if (listing.some((path) => /(?:^|\/)(?:tests|dev|node_modules|\.runtime)(?:\/|$)/.test(path))) {
    throw new Error(`ZIP 包含开发或运行目录：${basename(zip)}`);
  }
  if (skillHub && listing.some((path) => /(?:^|\/)(?:README\.md|agents\/|assets\/|docs\/|\.codebuddy-plugin\/|hooks\/)/.test(path))) {
    throw new Error(`SkillHub ZIP 包含不应公开的仓库文件：${basename(zip)}`);
  }
}

const version = assertSourceVersions(projectRoot);
const commit = assertCleanWorktree();
const workRoot = mkdtempSync(join(tmpdir(), `zhihuiji-release-${version}-`));

try {
  const skillHubStage = join(workRoot, 'skillhub');
  const githubStage = join(workRoot, `zhihuiji-business-posters-v${version}`);
  run(process.execPath, [join(projectRoot, 'scripts/prepare-skillhub-release.mjs'), skillHubStage]);
  run(process.execPath, [join(projectRoot, 'scripts/prepare-release.mjs'), githubStage]);

  assertPublicSkill(join(skillHubStage, 'SKILL.md'));
  assertPublicSkill(join(githubStage, 'skills/business-posters/SKILL.md'));
  assertNoLegacyFiles(skillHubStage);
  assertNoLegacyFiles(githubStage);
  assertNoSecrets(skillHubStage);
  assertNoSecrets(githubStage);
  const runtime = assertRuntimeParity(skillHubStage, join(githubStage, 'skills/business-posters'));

  mkdirSync(dirname(target), { recursive: true });
  mkdirSync(target, { recursive: false });
  const skillHubZip = join(target, `智慧记图报-SkillHub-v${version}.zip`);
  const githubZip = join(target, `智慧记图报-GitHub-v${version}.zip`);
  zipDirectory(skillHubStage, skillHubZip, { includeRoot: false });
  zipDirectory(githubStage, githubZip, { includeRoot: true });
  assertZipListing(skillHubZip, { skillHub: true });
  assertZipListing(githubZip, { skillHub: false });

  const artifacts = [skillHubZip, githubZip].map((path) => ({
    file: basename(path),
    size: lstatSync(path).size,
    sha256: sha256(path)
  }));
  const payload = {
    schema_version: 1,
    product: '智慧记图报',
    version,
    source_commit: commit,
    source_clean: true,
    runtime_file_count: Object.keys(runtime).length,
    runtime_sha256: createHash('sha256').update(JSON.stringify(runtime)).digest('hex'),
    skillhub_file_count: manifestFor(skillHubStage).length,
    github_file_count: manifestFor(githubStage).length,
    artifacts
  };
  writeFileSync(join(target, 'RELEASE.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, target, ...payload }, null, 2));
} catch (error) {
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  throw error;
} finally {
  rmSync(workRoot, { recursive: true, force: true });
}
