import { spawnSync } from 'node:child_process';
import { PosterError, amountToCents } from './calendar-core.mjs';

const MAX_CLI_ERROR_LENGTH = 1200;

export function sanitizeCliError(value, maxLength = MAX_CLI_ERROR_LENGTH) {
  let text = String(value ?? '').replace(/\s+/g, ' ').trim();
  text = text
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [已脱敏]')
    .replace(/\b(authorization|access[_-]?token|refresh[_-]?token|token|cookie|set-cookie)\b\s*[:=]\s*([^\s,;]+)/gi, '$1=[已脱敏]')
    .replace(/([?&](?:access_token|refresh_token|token|auth|authorization|cookie)=)[^&#\s]*/gi, '$1[已脱敏]')
    .replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, '[手机号已脱敏]');
  if (text.length > maxLength) text = `${text.slice(0, maxLength)}…`;
  return text || '未提供错误详情';
}

function runAilitRaw(args, label) {
  const result = spawnSync('ailit', [...args, '--format', 'json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error?.code === 'ENOENT') throw new PosterError('AILIT_MISSING', '未找到 ailit CLI');
  if (result.status !== 0) {
    const message = sanitizeCliError(result.stderr || result.stdout);
    throw new PosterError('AILIT_FAILED', `${label} 读取失败：${message}`);
  }
  return result.stdout;
}

export function parseLeadingJson(value) {
  const text = String(value ?? '').trimStart();
  const opener = text[0];
  const closer = opener === '{' ? '}' : opener === '[' ? ']' : null;
  if (!closer) throw new PosterError('AILIT_JSON', '返回内容没有 JSON 数据');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        const jsonText = text.slice(0, index + 1);
        try {
          return { data: JSON.parse(jsonText), trailing: text.slice(index + 1).trim() };
        } catch {
          throw new PosterError('AILIT_JSON', '返回了无效 JSON');
        }
      }
    }
  }
  throw new PosterError('AILIT_JSON', '返回的 JSON 数据不完整');
}

export function runAilitJson(args, { label = args.slice(0, 3).join(' ') } = {}) {
  const stdout = runAilitRaw(args, label);
  try {
    return JSON.parse(stdout);
  } catch {
    throw new PosterError('AILIT_JSON', `${label} 返回了无效数据`);
  }
}

export function runAilitJsonWithTrailing(args, { label = args.slice(0, 3).join(' ') } = {}) {
  return parseLeadingJson(runAilitRaw(args, label));
}

export function ensureAilitHealthy() {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const doctor = runAilitJson(['doctor'], { label: '连接检查' });
      if (doctor.allPass === true) return;
      lastError = new PosterError('AILIT_UNHEALTHY', '智慧记连接检查未通过');
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError?.code === 'AILIT_MISSING') throw lastError;
  throw new PosterError('AILIT_UNHEALTHY', '智慧记连接检查未通过', {
    cause_code: lastError?.code || 'UNKNOWN'
  });
}

function stableId(row) {
  for (const field of ['id', 'product_id', 'company_id', 'operator_id']) {
    if (row?.[field] !== undefined && row?.[field] !== null) return `${field}:${row[field]}`;
  }
  return null;
}

export function fetchPaged(baseArgs, { start = null, end = null, label = baseArgs.join(' ') } = {}) {
  const rows = [];
  const seen = new Set();
  let page = 1;
  let expectedTotal = null;
  while (true) {
    const args = [...baseArgs];
    if (start && end) args.push('-s', start, '-e', end);
    args.push('-p', String(page), '-z', '100');
    const response = runAilitJson(args, { label });
    if (!response || !Number.isInteger(response.total) || !Array.isArray(response.list)) {
      throw new PosterError('PAGINATION_SHAPE', `${label} 分页结构异常`);
    }
    if (expectedTotal === null) expectedTotal = response.total;
    if (response.total !== expectedTotal) throw new PosterError('PAGINATION_CHANGED', `${label} 拉取过程中总数发生变化`);
    for (const row of response.list) {
      const id = stableId(row);
      if (id && seen.has(id)) throw new PosterError('PAGINATION_DUPLICATE', `${label} 跨页出现重复记录`);
      if (id) seen.add(id);
      rows.push(row);
    }
    if (rows.length >= expectedTotal) break;
    if (response.list.length === 0) throw new PosterError('PAGINATION_INCOMPLETE', `${label} 分页提前结束`);
    page += 1;
    if (page > 10000) throw new PosterError('PAGINATION_LIMIT', `${label} 分页超过安全上限`);
  }
  if (rows.length !== expectedTotal) {
    throw new PosterError('PAGINATION_COUNT', `${label} 分页条数不一致`);
  }
  return { rows, total: expectedTotal };
}

export function assertNoUnverifiedReturns(rows, label) {
  if (!Array.isArray(rows)) throw new PosterError('RETURN_SHAPE', `${label} 不是数组`);
  if (rows.length > 0) {
    throw new PosterError(
      'SALES_RETURN_UNVERIFIED',
      `${label}存在销售退货，当前版本尚未取得可验证的真实退款字段，已停止生成`
    );
  }
}

export function assertVerifiedReceiptStatus(row) {
  if (row?.status !== 1) {
    throw new PosterError(
      'RECEIPT_STATUS_UNVERIFIED',
      '收款单出现尚未验证的状态，已停止生成'
    );
  }
}

export function fetchValidatedReceipts(range, label = '收款单') {
  const rows = fetchPaged(['receipt', 'list'], {
    start: range.start,
    end: range.end,
    label
  }).rows;
  return rows.map((row) => {
    assertVerifiedReceiptStatus(row);
    if (row?.id === undefined || row?.id === null || row.id === '') {
      throw new PosterError('RECEIPT_DETAIL_SHAPE', `${label}缺少稳定编号`);
    }
    const detail = runAilitJson(['receipt', 'get', String(row.id)], { label: `${label}详情` });
    if (!detail?.base || !Array.isArray(detail.items)) {
      throw new PosterError('RECEIPT_DETAIL_SHAPE', `${label}详情缺少 base/items`);
    }
    if (String(detail.base.id) !== String(row.id)
      || detail.base.bill_date !== row.bill_date
      || Math.abs(amountToCents(detail.base.total_amt, `${label}详情.total_amt`) - amountToCents(row.total_amt, `${label}列表.total_amt`)) > 1) {
      throw new PosterError('RECEIPT_DETAIL_MISMATCH', `${label}列表与详情不一致`);
    }
    if (amountToCents(detail.base.preferential_amt, `${label}详情.preferential_amt`) !== 0
      || amountToCents(detail.base.prepaid_amt, `${label}详情.prepaid_amt`) !== 0) {
      throw new PosterError('RECEIPT_PREFERENTIAL_UNVERIFIED', `${label}存在尚未验证的优惠或预存款抵扣`);
    }
    const accountTotal = detail.items.reduce(
      (sum, item) => sum + amountToCents(item.amt, `${label}账户明细.amt`),
      0
    );
    if (Math.abs(accountTotal - amountToCents(row.total_amt, `${label}列表.total_amt`)) > 1) {
      throw new PosterError('RECEIPT_ACCOUNT_MISMATCH', `${label}账户明细与收款金额不一致`);
    }
    return { ...row, receipt_accounts: detail.items };
  });
}
