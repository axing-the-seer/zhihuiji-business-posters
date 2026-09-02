import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_AILIT_VERSION,
  REQUIRED_AILIT_CAPABILITIES,
  parseAilitVersion,
  parseLeadingJson,
  sanitizeCliError,
  versionAtLeast
} from '../scripts/ailit-runtime.mjs';
import { PosterError } from '../scripts/calendar-core.mjs';
import { validateEmbeddedAssets } from '../scripts/embedded-assets.mjs';
import { preflightEnvironment } from '../scripts/preflight.mjs';
import { userMessageFor } from '../scripts/user-errors.mjs';

test('CLI 错误会脱敏认证信息、手机号并限制长度', () => {
  const result = sanitizeCliError(
    `Authorization: Bearer secret-token Cookie=session-secret token=another-secret phone=13800138000 ${'x'.repeat(200)}`,
    120
  );
  assert.doesNotMatch(result, /secret-token|session-secret|another-secret|13800138000/);
  assert.match(result, /已脱敏/);
  assert.ok(result.length <= 121);
});

test('CLI 返回值可读取前置 JSON 并隔离尾部提示', () => {
  const parsed = parseLeadingJson('{"total":1,"list":[{"id":1}]}\n额外提示');
  assert.deepEqual(parsed.data, { total: 1, list: [{ id: 1 }] });
  assert.equal(parsed.trailing, '额外提示');
});

test('ailit 版本与关键能力合同固定', () => {
  assert.equal(MIN_AILIT_VERSION, '0.8.1');
  assert.deepEqual(parseAilitVersion('ailit version 0.8.1'), [0, 8, 1]);
  assert.equal(versionAtLeast('0.8.1'), true);
  assert.equal(versionAtLeast('0.9.0'), true);
  assert.equal(versionAtLeast('0.8.0'), false);
  assert.equal(versionAtLeast('unexpected'), false);
  assert.ok(REQUIRED_AILIT_CAPABILITIES.length >= 14);
  assert.ok(REQUIRED_AILIT_CAPABILITIES.some((row) => row.join(' ') === 'receipt get'));
  assert.ok(REQUIRED_AILIT_CAPABILITIES.some((row) => row.join(' ') === 'report purchase-stat'));
});

test('对外错误文案不暴露连接器、安装、网络或本地路径', () => {
  const cases = [
    new PosterError('AILIT_MISSING', 'missing executable'),
    new PosterError('AILIT_UNSUPPORTED', 'version 0.7.0'),
    new PosterError('AILIT_CAPABILITY_MISSING', 'receipt get'),
    new PosterError('RENDERER_MISSING', 'npm failed'),
    new PosterError('OUTPUT_EXISTS', '/Users/example/private/output.png')
  ];
  for (const error of cases) {
    const message = userMessageFor(error, 'monthly');
    assert.doesNotMatch(message, /Connector|npm|JSON|组件|安装|网络|\/Users\/|exit|code/i);
  }
});

test('发布包内置的五张原图完整可用', () => {
  assert.deepEqual(validateEmbeddedAssets(), { ok: true, count: 5 });
});

test('启动前环境检测可在不连接智慧记时完成图片初始化', async () => {
  const result = await preflightEnvironment({ requireAilit: false });
  assert.equal(result.ok, true);
  assert.equal(result.assets, 5);
  assert.equal(result.renderer, 'ready');
  assert.equal(result.ailit, 'skipped');
  assert.equal(result.ailit_version, null);
  assert.equal(result.ailit_capabilities, 0);
});
