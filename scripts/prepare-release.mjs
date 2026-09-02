#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertNoLegacyFiles,
  assertNoSecrets,
  assertPublicSkill,
  assertSourceVersions,
  manifestFor
} from './release-guard.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetArg = process.argv[2];
if (!targetArg || !isAbsolute(targetArg)) throw new Error('请提供一个不存在的绝对目录作为发布暂存位置');
const target = resolve(targetArg);
if (target === projectRoot || target === dirname(projectRoot) || basename(target) === '') throw new Error('发布暂存位置不安全');
if (existsSync(target)) throw new Error('发布暂存位置必须是一个尚不存在的目录');

const allowlist = [
  '.codebuddy-plugin/plugin.json',
  'docs/DEVELOPMENT.md',
  'docs/screenshots',
  'hooks/hooks.json',
  'icon.png',
  'README.md',
  'scripts/install-dependencies.mjs',
  'skills/business-posters/SKILL.md',
  'skills/business-posters/agents',
  'skills/business-posters/assets',
  'skills/business-posters/package.json',
  'skills/business-posters/package-lock.json',
  'skills/business-posters/references',
  'skills/business-posters/scripts'
];

mkdirSync(target, { recursive: false });
for (const sourceRelative of allowlist) {
  const source = join(projectRoot, sourceRelative);
  if (!existsSync(source)) throw new Error(`发布白名单文件缺失：${sourceRelative}`);
  const destination = join(target, sourceRelative);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: statSync(source).isDirectory(), errorOnExist: true });
}

function filesUnder(directory) {
  const rows = [];
  for (const name of readdirSync(directory).sort()) {
    const absolute = join(directory, name);
    if (statSync(absolute).isDirectory()) rows.push(...filesUnder(absolute));
    else rows.push(absolute);
  }
  return rows;
}

const forbidden = [
  `${sep}tests${sep}`,
  `${sep}fixtures${sep}`,
  `${sep}dev${sep}`,
  `${sep}node_modules${sep}`,
  `${sep}.runtime${sep}`,
  `${sep}经营海报输出${sep}`
];
const files = filesUnder(target);
for (const file of files) {
  if (forbidden.some((fragment) => file.includes(fragment)) || /\.(?:pdf|log|zip)$/i.test(file)) {
    throw new Error(`发布暂存目录出现禁止文件：${relative(target, file)}`);
  }
}

assertPublicSkill(join(target, 'skills/business-posters/SKILL.md'));
assertNoLegacyFiles(target);
assertNoSecrets(target);
const readme = readFileSync(join(target, 'README.md'), 'utf8');
if (/经营日报|智慧记经营参谋|客户欠款|导出对账单|PDF/i.test(readme)) {
  throw new Error('GitHub README 仍包含已移除功能');
}
const version = assertSourceVersions(projectRoot);
const manifest = manifestFor(target);
writeFileSync(join(target, 'RELEASE_MANIFEST.json'), `${JSON.stringify({ schema_version: 1, files: manifest }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, version, target, file_count: manifest.length + 1 }, null, 2));
