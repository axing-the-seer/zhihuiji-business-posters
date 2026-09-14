import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export function relativePath(root, path) {
  return relative(root, path).split(sep).join('/');
}

export function filesUnder(directory, root = directory) {
  const rows = [];
  for (const name of readdirSync(directory).sort()) {
    const absolute = join(directory, name);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`发布内容不允许符号链接：${relativePath(root, absolute)}`);
    if (stat.isDirectory()) rows.push(...filesUnder(absolute, root));
    else if (stat.isFile()) rows.push(absolute);
  }
  return rows;
}

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function assertSourceVersions(projectRoot) {
  const skill = JSON.parse(readFileSync(join(projectRoot, 'skills/business-posters/package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(projectRoot, 'skills/business-posters/package-lock.json'), 'utf8'));
  const plugin = JSON.parse(readFileSync(join(projectRoot, '.codebuddy-plugin/plugin.json'), 'utf8'));
  const versions = [skill.version, lock.version, lock.packages?.['']?.version, plugin.version];
  if (versions.some((value) => value !== versions[0])) {
    throw new Error(`版本号不一致：${versions.join(', ')}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(versions[0])) throw new Error('版本号必须为 x.y.z');
  return versions[0];
}

export function assertPublicSkill(path) {
  const source = readFileSync(path, 'utf8');
  const parts = source.split(/^---\s*$/m);
  if (parts.length < 3) throw new Error('SKILL.md 缺少完整头部');
  const frontmatter = parts[1];
  const body = parts.slice(2).join('---');
  const workflowHint = '<!-- 执行时先阅读 references/runtime-workflow.md。 -->';
  if (!body.includes(workflowHint)) throw new Error('SKILL.md 缺少内部使用说明入口');
  const visibleBody = body.replace(workflowHint, '');
  if (/<!--|-->/.test(visibleBody)) throw new Error('SKILL.md 含未审核的隐藏内容');
  if (!/^name:\s*business-posters\s*$/m.test(frontmatter)) throw new Error('SKILL.md 名称不正确');
  if (!/^description:\s*\S.+$/m.test(frontmatter)) throw new Error('SKILL.md 缺少产品说明');
  const examplesZh = frontmatter.match(/^\s{2}-\s*".+"\s*$/gm) || [];
  if (examplesZh.length !== 6) throw new Error('SKILL.md 必须包含 3 条中文和 3 条英文示例');
  const forbidden = [
    /```/,
    /\b(?:node|npm|JSON|CLI|PATH|Shell)\b/i,
    /user_message|internal_error|<skill-root>|absolute-png-path|absolute-directory/i,
    /绝对路径|禁止自修复|执行次数|自动安装|依赖|命令|错误码|重试/,
    /references\/|\]\([^)]*runtime-workflow|使用说明/
  ];
  for (const pattern of forbidden) {
    if (pattern.test(visibleBody)) throw new Error(`SKILL.md 公开正文含技术内容：${pattern}`);
  }
  const removedCapabilities = [/经营日报/, /智慧记经营参谋/, /导出对账单/, /客户欠款明细/, /PDF/i];
  for (const pattern of removedCapabilities) {
    if (pattern.test(source)) throw new Error(`SKILL.md 仍包含已移除功能：${pattern}`);
  }
  for (const required of ['智慧记图报', '经营日历', '经营月报', 'examples_zh']) {
    if (!source.includes(required)) throw new Error(`SKILL.md 缺少：${required}`);
  }
}

export function assertSkillHubSkill(path, expectedVersion) {
  assertPublicSkill(path);
  const source = readFileSync(path, 'utf8');
  const frontmatter = source.split(/^---\s*$/m)[1];
  if (!/^slug:\s*zhihuiji-business-posters\s*$/m.test(frontmatter)) throw new Error('SkillHub slug 不匹配现有条目');
  if (!/^displayName:\s*智慧记图报\s*$/m.test(frontmatter)) throw new Error('SkillHub 展示名不正确');
  const version = frontmatter.match(/^version:\s*(\S+)\s*$/m)?.[1];
  if (!/^\d+\.\d+\.\d+$/.test(version || '') || version !== expectedVersion) throw new Error('SkillHub 版本号与运行包不一致');
  if (!/^summary:\s*\S.+$/m.test(frontmatter)) throw new Error('SkillHub 缺少简介');
}

export function assertNoLegacyFiles(root) {
  const patterns = [
    /daily-report|daily_report/i,
    /customer-statement|customer_statement/i,
    /reconcile-and-export|reconcile_and_export/i
  ];
  for (const file of filesUnder(root)) {
    const path = relativePath(root, file);
    if (patterns.some((pattern) => pattern.test(path))) throw new Error(`发布包出现旧功能文件：${path}`);
  }
}

export function assertNoSecrets(root) {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/i,
    /\b(?:access[_-]?token|refresh[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?[A-Za-z0-9._~+\/-]{12,}/i,
    /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/
  ];
  for (const file of filesUnder(root)) {
    const path = relativePath(root, file);
    if (/scripts\/embedded-.+\.mjs$/.test(path)) continue;
    const stat = lstatSync(file);
    if (stat.size > 2 * 1024 * 1024) continue;
    const source = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      if (pattern.test(source)) throw new Error(`发布内容疑似包含敏感信息：${path}`);
    }
  }
}

function runtimeManifest(root) {
  const files = filesUnder(root)
    .map((file) => relativePath(root, file))
    .filter((path) => path === 'package.json'
      || path === 'package-lock.json'
      || path.startsWith('references/')
      || path.startsWith('scripts/'));
  return new Map(files.map((path) => [path, sha256(join(root, path))]));
}

export function assertRuntimeParity(skillHubRoot, githubSkillRoot) {
  const left = runtimeManifest(skillHubRoot);
  const right = runtimeManifest(githubSkillRoot);
  const paths = [...new Set([...left.keys(), ...right.keys()])].sort();
  for (const path of paths) {
    if (!left.has(path) || !right.has(path)) throw new Error(`两个发布版运行文件不一致：${path}`);
    if (left.get(path) !== right.get(path)) throw new Error(`两个发布版代码哈希不一致：${path}`);
  }
  return Object.fromEntries(paths.map((path) => [path, left.get(path)]));
}

export function manifestFor(root) {
  return filesUnder(root).map((file) => ({
    path: relativePath(root, file),
    size: lstatSync(file).size,
    sha256: sha256(file)
  }));
}
