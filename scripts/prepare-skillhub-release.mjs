#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import {
  assertNoLegacyFiles,
  assertNoSecrets,
  assertSkillHubSkill,
  assertSourceVersions,
  filesUnder
} from './release-guard.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillRoot = join(projectRoot, 'skills', 'business-posters');
const targetArg = process.argv[2];
if (!targetArg || !isAbsolute(targetArg)) throw new Error('请提供一个不存在的绝对目录作为 SkillHub 暂存位置');
const target = resolve(targetArg);
if (target === projectRoot || target === dirname(projectRoot) || basename(target) === '') throw new Error('发布暂存位置不安全');
if (existsSync(target)) throw new Error('SkillHub 暂存位置必须是一个尚不存在的目录');

const allowlist = [
  'package.json',
  'package-lock.json',
  'references',
  'scripts'
];

mkdirSync(target, { recursive: false });
for (const sourceRelative of allowlist) {
  const source = join(skillRoot, sourceRelative);
  if (!existsSync(source)) throw new Error(`SkillHub 发布文件缺失：${sourceRelative}`);
  const destination = join(target, sourceRelative);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: statSync(source).isDirectory(), errorOnExist: true });
}

const version = assertSourceVersions(projectRoot);
const skillTemplate = readFileSync(join(projectRoot, 'packaging/skillhub/SKILL.md.template'), 'utf8');
if (!skillTemplate.includes('__VERSION__')) throw new Error('SkillHub SKILL.md 模板缺少版本占位符');
writeFileSync(join(target, 'SKILL.md'), skillTemplate.replaceAll('__VERSION__', version), { encoding: 'utf8', flag: 'wx' });

const files = filesUnder(target);
for (const file of files) {
  const path = relative(target, file).split(sep).join('/');
  if (/\.(?:png|jpe?g|webp|gif|pdf|zip|log)$/i.test(path)
    || path.includes('/node_modules/')
    || path.includes('/tests/')
    || path.includes('/dev/')
    || path.includes('/.runtime/')) {
    throw new Error(`SkillHub 暂存目录出现禁止文件：${path}`);
  }
}

const requiredEmbeddedFiles = [
  'scripts/preflight.mjs',
  'scripts/embedded-assets.mjs',
  'scripts/embedded-workbuddy-logo.mjs',
  'scripts/embedded-zhihuiji-logo.mjs',
  'scripts/embedded-zhihuiji-qr.mjs',
  'scripts/embedded-calendar-header.mjs',
  'scripts/embedded-monthly-header.mjs'
];
for (const path of requiredEmbeddedFiles) {
  if (!existsSync(join(target, path))) throw new Error(`SkillHub 发布文件缺失：${path}`);
}

for (const renderFile of ['scripts/calendar-render.mjs', 'scripts/monthly-report-render.mjs']) {
  const source = readFileSync(join(target, renderFile), 'utf8');
  if (!source.includes('embeddedImageData')) throw new Error(`${renderFile} 未使用内嵌图片资源`);
  if (/file:\/\/|from ['"]\.\/visual-brand\.mjs['"]|readFileSync\([^)]*assets\//.test(source)) {
    throw new Error(`${renderFile} 仍依赖本地图片文件或旧版矢量替代图`);
  }
}

const embeddedAssets = await import(pathToFileURL(join(target, 'scripts', 'embedded-assets.mjs')).href);
const embeddedValidation = embeddedAssets.validateEmbeddedAssets();
if (embeddedValidation.count !== 5) throw new Error('SkillHub 发布包内嵌图片数量异常');
assertSkillHubSkill(join(target, 'SKILL.md'), version);
assertNoLegacyFiles(target);
assertNoSecrets(target);

console.log(JSON.stringify({
  ok: true,
  version,
  target,
  file_count: files.length,
  binary_asset_count: 0,
  embedded_asset_count: embeddedValidation.count
}, null, 2));
