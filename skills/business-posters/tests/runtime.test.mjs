import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLeadingJson, sanitizeCliError } from '../scripts/ailit-runtime.mjs';

test('CLI 错误会脱敏认证信息、手机号并限制长度', () => {
  const result = sanitizeCliError(
    `Authorization: Bearer secret-token Cookie=session-secret token=another-secret phone=13800138000 ${'x'.repeat(200)}`,
    120
  );
  assert.doesNotMatch(result, /secret-token|session-secret|another-secret|13800138000/);
  assert.match(result, /已脱敏/);
  assert.ok(result.length <= 121);
});

test('客户对账明细可读取前置 JSON 并隔离尾部 PDF 提示', () => {
  const parsed = parseLeadingJson('{"total":1,"list":[{"id":1}]}\n对账单 PDF: https://space.zhihuiji.cn/example.pdf');
  assert.deepEqual(parsed.data, { total: 1, list: [{ id: 1 }] });
  assert.match(parsed.trailing, /^对账单 PDF:/);
});
