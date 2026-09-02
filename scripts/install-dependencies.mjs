#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fileHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function initializeDependencies() {
  const sourceDir = join(projectRoot, 'skills', 'business-posters');
  const packageJson = join(sourceDir, 'package.json');
  const packageLock = join(sourceDir, 'package-lock.json');
  const pluginData = process.env.CODEBUDDY_PLUGIN_DATA
    || process.env.WORKBUDDY_PLUGIN_DATA
    || join(projectRoot, '.runtime');
  const installDir = resolve(pluginData, 'business-posters-runtime');
  const markerPath = join(installDir, '.dependency-hash');
  if (!existsSync(packageJson) || !existsSync(packageLock)) return false;

  const dependencyHash = createHash('sha256')
    .update(fileHash(packageJson))
    .update(fileHash(packageLock))
    .digest('hex');
  const installedSharp = join(installDir, 'node_modules', 'sharp', 'package.json');
  const currentHash = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : '';
  if (currentHash === dependencyHash && existsSync(installedSharp)) return true;

  mkdirSync(installDir, { recursive: true });
  copyFileSync(packageJson, join(installDir, 'package.json'));
  copyFileSync(packageLock, join(installDir, 'package-lock.json'));

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCommand, ['ci', '--omit=dev'], {
    cwd: installDir,
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 180000
  });
  if (result.error || result.status !== 0 || !existsSync(installedSharp)) return false;
  writeFileSync(markerPath, `${dependencyHash}\n`, { encoding: 'utf8', flag: 'w' });
  return true;
}

try {
  initializeDependencies();
} catch {
  // SessionStart must stay silent. The generation command reports a user-safe failure if needed.
}
