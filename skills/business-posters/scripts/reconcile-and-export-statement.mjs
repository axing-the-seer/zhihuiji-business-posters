#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { PosterError, amountToCents, isIsoDate } from './calendar-core.mjs';
import { validateStatementAmounts } from './customer-statement-core.mjs';
import { ensureAilitHealthy, fetchPaged, runAilitJson, runAilitJsonWithTrailing, sanitizeCliError } from './ailit-runtime.mjs';

const ALLOWED_PDF_HOSTS = new Set([
  'space.zhihuiji.cn',
  'space-1319132088.cos.ap-beijing.myqcloud.com'
]);
const MAX_PDF_BYTES = 25 * 1024 * 1024;

function requestFromStdin() {
  let request;
  try {
    request = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    throw new PosterError('REQUEST_INVALID', '导出请求不是有效数据');
  }
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new PosterError('REQUEST_INVALID', '导出请求不是对象');
  }
  const customer = String(request.customer ?? '').trim();
  const start = String(request.start ?? '').trim();
  const end = String(request.end ?? '').trim();
  const output = String(request.output ?? '').trim();
  const companyId = request.company_id === undefined || request.company_id === null
    ? null
    : String(request.company_id).trim();
  if (!customer) throw new PosterError('REQUEST_INVALID', '缺少客户名称');
  if (!isIsoDate(start) || !isIsoDate(end) || start > end) throw new PosterError('REQUEST_INVALID', '对账日期范围无效');
  if (!isAbsolute(output) || !output.toLowerCase().endsWith('.pdf')) {
    throw new PosterError('REQUEST_INVALID', '对账单保存位置必须是绝对 PDF 路径');
  }
  if (existsSync(output)) throw new PosterError('OUTPUT_EXISTS', '目标位置已经存在同名文件');
  return { customer, start, end, output: resolve(output), companyId };
}

function normalizedName(value) {
  return String(value ?? '').trim().toLocaleLowerCase('zh-CN');
}

function chooseCustomer(rows, request) {
  const unique = new Map();
  for (const row of rows) {
    if (row?.company_id === undefined || row?.company_id === null || !String(row.company_name ?? '').trim()) continue;
    unique.set(String(row.company_id), row);
  }
  if (request.companyId) {
    const selected = unique.get(request.companyId);
    if (!selected) throw new PosterError('CUSTOMER_NOT_FOUND', '没有找到所选客户');
    return selected;
  }
  const exact = [...unique.values()].filter((row) => normalizedName(row.company_name) === normalizedName(request.customer));
  if (exact.length === 1) return exact[0];
  const candidates = exact.length > 1 ? exact : [...unique.values()];
  if (candidates.length === 0) throw new PosterError('CUSTOMER_NOT_FOUND', '没有找到匹配的客户');
  throw new PosterError('CUSTOMER_AMBIGUOUS', '找到多个可能的客户，需要先确认具体客户', {
    choices: candidates.slice(0, 10).map((row) => ({
      company_id: String(row.company_id),
      company_name: String(row.company_name)
    }))
  });
}

function sameAmount(label, left, right) {
  const leftCents = amountToCents(left, `${label}.列表`);
  const rightCents = amountToCents(right, `${label}.明细`);
  if (Math.abs(leftCents - rightCents) > 1) {
    throw new PosterError('STATEMENT_AMOUNT_MISMATCH', `${label}在客户列表与对账明细中不一致`);
  }
}

function fetchCustomerDetail(companyId, start, end) {
  const rows = [];
  const seen = new Set();
  let page = 1;
  let expectedTotal = null;
  let summary = null;
  while (true) {
    const { data: response } = runAilitJsonWithTrailing([
      'report', 'customer-check', 'detail', companyId,
      '-s', start, '-e', end, '-p', String(page), '-z', '100'
    ], { label: '客户对账明细' });
    if (!response || !Number.isInteger(response.total) || !Array.isArray(response.list)) {
      throw new PosterError('STATEMENT_DETAIL_SHAPE', '客户对账明细分页结构异常');
    }
    const currentSummary = {
      bill_real: response.sum_bill_real_amt,
      should_pay: response.sum_should_pay_amt,
      real_pay: response.sum_real_pay_amt,
      owe: response.sum_owe_amt,
      terminal: response.sum_all_terminal
    };
    if (expectedTotal === null) {
      expectedTotal = response.total;
      summary = currentSummary;
    } else {
      if (response.total !== expectedTotal) throw new PosterError('STATEMENT_DETAIL_CHANGED', '客户对账明细读取过程中总数发生变化');
      for (const key of Object.keys(summary)) sameAmount(`对账明细.${key}`, summary[key], currentSummary[key]);
    }
    for (const row of response.list) {
      const id = `${row?.type_name ?? ''}:${row?.id ?? ''}`;
      if (seen.has(id)) throw new PosterError('STATEMENT_DETAIL_DUPLICATE', '客户对账明细跨页出现重复记录');
      seen.add(id);
      rows.push(row);
    }
    if (rows.length >= expectedTotal || response.is_last_page === true) break;
    if (response.list.length === 0) throw new PosterError('STATEMENT_DETAIL_INCOMPLETE', '客户对账明细分页提前结束');
    page += 1;
    if (page > 10000) throw new PosterError('STATEMENT_DETAIL_LIMIT', '客户对账明细分页超过安全上限');
  }
  if (rows.length !== expectedTotal) throw new PosterError('STATEMENT_DETAIL_COUNT', '客户对账明细条数不一致');
  return { rows, summary };
}

function findPdfUrl(value) {
  if (typeof value === 'string' && /^https:\/\//i.test(value)) return value;
  if (!value || typeof value !== 'object') return null;
  for (const key of ['pdf_url', 'download_url', 'url']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && /^https:\/\//i.test(candidate)) return candidate;
  }
  if (value.data) return findPdfUrl(value.data);
  return null;
}

function validatedPdfUrl(response) {
  const raw = findPdfUrl(response);
  if (!raw) throw new PosterError('PDF_URL_MISSING', '智慧记没有返回可下载的对账单地址');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !ALLOWED_PDF_HOSTS.has(url.hostname.toLowerCase())) {
    throw new PosterError('PDF_URL_UNTRUSTED', '对账单下载地址未通过安全检查');
  }
  return url;
}

async function downloadPdf(url, output) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new PosterError('PDF_DOWNLOAD_FAILED', `对账单下载失败：HTTP ${response.status}`);
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > MAX_PDF_BYTES) throw new PosterError('PDF_TOO_LARGE', '对账单文件超过大小限制');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_PDF_BYTES) throw new PosterError('PDF_INVALID', '对账单文件大小异常');
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new PosterError('PDF_INVALID', '下载结果不是有效 PDF');
  mkdirSync(dirname(output), { recursive: true });
  const temporary = `${output}.partial-${process.pid}`;
  try {
    writeFileSync(temporary, buffer, { flag: 'wx' });
    renameSync(temporary, output);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
  return buffer.length;
}

function userMessageFor(error) {
  if (error?.code === 'CUSTOMER_NOT_FOUND') return '没有找到匹配的客户，请确认客户名称后重试。';
  if (error?.code === 'CUSTOMER_AMBIGUOUS') return '找到多个可能的客户，请先选择具体客户。';
  if (error?.code === 'OUTPUT_EXISTS') return '保存位置已经有同名对账单，请换一个文件名。';
  if (error?.code === 'REQUEST_INVALID') return error.message;
  if (String(error?.code || '').startsWith('PDF_')) return '官方对账单暂时无法安全下载，请稍后重试。';
  return '客户对账数据未通过核对，本次没有导出对账单。';
}

async function main() {
  const request = requestFromStdin();
  ensureAilitHealthy();
  const list = fetchPaged([
    'report', 'customer-check', 'list', '--keyword', request.customer, '--hide-zero=false'
  ], { start: request.start, end: request.end, label: '客户对账列表' });
  const customer = chooseCustomer(list.rows, request);
  const detail = fetchCustomerDetail(String(customer.company_id), request.start, request.end);
  const amounts = validateStatementAmounts(customer, detail);
  const pdfResponse = runAilitJson([
    'customer', 'print', 'pdf', String(customer.company_id),
    '-s', request.start, '-e', request.end
  ], { label: '官方客户对账单' });
  const pdfUrl = validatedPdfUrl(pdfResponse);
  const size = await downloadPdf(pdfUrl, request.output);
  console.log(JSON.stringify({
    ok: true,
    customer: { company_id: String(customer.company_id), company_name: String(customer.company_name) },
    period: { start: request.start, end: request.end },
    amounts: {
      beginning: amounts.beginning_cents / 100,
      should_pay: amounts.should_pay_cents / 100,
      real_pay: amounts.real_pay_cents / 100,
      net_change: amounts.net_change_cents / 100,
      ending_debt: amounts.ending_debt_cents / 100
    },
    output: request.output,
    size_bytes: size
  }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error?.code || 'UNEXPECTED',
    user_message: userMessageFor(error),
    choices: error?.details?.choices,
    internal_error: sanitizeCliError(error?.message || String(error))
  }, null, 2));
  process.exit(1);
}
