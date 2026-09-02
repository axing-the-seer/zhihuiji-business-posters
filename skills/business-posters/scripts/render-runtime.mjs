import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(scriptDir, '..');
const require = createRequire(import.meta.url);

function pluginDataRoots() {
  const systemCache = process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Caches', 'zhihuiji-business-posters')
    : process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'zhihuiji-business-posters')
      : join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'zhihuiji-business-posters');
  return [...new Set([
    process.env.CODEBUDDY_PLUGIN_DATA,
    process.env.WORKBUDDY_PLUGIN_DATA,
    systemCache,
    join(skillRoot, '.runtime')
  ].filter(Boolean).map((value) => resolve(value)))];
}

function packageHash() {
  const packageJson = readFileSync(join(skillRoot, 'package.json'));
  const packageLock = readFileSync(join(skillRoot, 'package-lock.json'));
  return createHash('sha256').update(packageJson).update(packageLock).digest('hex');
}

function installSharpRuntime(dataRoot) {
  const installDir = join(dataRoot, 'business-posters-runtime');
  const markerPath = join(installDir, '.dependency-hash');
  const installedSharp = join(installDir, 'node_modules', 'sharp', 'package.json');
  const expectedHash = packageHash();
  const currentHash = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : '';
  if (currentHash === expectedHash && existsSync(installedSharp)) return installDir;

  mkdirSync(installDir, { recursive: true });
  copyFileSync(join(skillRoot, 'package.json'), join(installDir, 'package.json'));
  copyFileSync(join(skillRoot, 'package-lock.json'), join(installDir, 'package-lock.json'));
  const siblingNpm = join(dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const npmCommand = existsSync(siblingNpm) ? siblingNpm : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const result = spawnSync(npmCommand, ['ci', '--omit=dev'], {
    cwd: installDir,
    env: process.env,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 180000
  });
  if (result.error || result.status !== 0 || !existsSync(installedSharp)) {
    const error = new Error('图片渲染依赖初始化失败');
    error.code = 'DEPENDENCY_INSTALL_FAILED';
    throw error;
  }
  writeFileSync(markerPath, `${expectedHash}\n`, 'utf8');
  return installDir;
}

export async function loadSharp() {
  try {
    const module = await import('sharp');
    return module.default;
  } catch (localError) {
    for (const dataRoot of pluginDataRoots()) {
      try {
        return require(join(dataRoot, 'business-posters-runtime', 'node_modules', 'sharp'));
      } catch {
        // Try the next supported plugin data location.
      }
    }
    let installError = localError;
    for (const dataRoot of pluginDataRoots()) {
      try {
        const installDir = installSharpRuntime(dataRoot);
        return require(join(installDir, 'node_modules', 'sharp'));
      } catch (error) {
        installError = error;
        if (error?.code === 'DEPENDENCY_INSTALL_FAILED') break;
      }
    }
    throw new Error('图片渲染依赖无法在可写位置完成初始化', { cause: installError });
  }
}
