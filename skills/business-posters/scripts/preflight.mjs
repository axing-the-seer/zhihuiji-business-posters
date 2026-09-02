import { PosterError } from './calendar-core.mjs';
import { ensureAilitHealthy } from './ailit-runtime.mjs';
import { validateEmbeddedAssets } from './embedded-assets.mjs';
import { loadSharp } from './render-runtime.mjs';

function assertNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20 || (major === 20 && minor < 9)) {
    throw new PosterError('NODE_UNSUPPORTED', `需要 Node.js 20.9 或更高版本，当前为 ${process.versions.node}`);
  }
}

export async function preflightEnvironment({ requireAilit = true } = {}) {
  assertNodeVersion();
  try {
    validateEmbeddedAssets();
  } catch (error) {
    throw new PosterError('ASSET_INVALID', '内置图片资源不完整', { cause: error?.message || String(error) });
  }
  try {
    await loadSharp();
  } catch (error) {
    throw new PosterError('RENDERER_MISSING', '图片渲染组件自动安装失败', { cause: error?.message || String(error) });
  }
  const ailit = requireAilit ? ensureAilitHealthy() : null;
  return {
    ok: true,
    node: process.versions.node,
    assets: 5,
    renderer: 'ready',
    ailit: requireAilit ? 'ready' : 'skipped',
    ailit_version: ailit?.version || null,
    ailit_capabilities: ailit?.capabilities || 0
  };
}
