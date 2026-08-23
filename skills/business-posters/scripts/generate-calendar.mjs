#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PosterError, buildCalendarModel, collectionRanges, formatMoney, todayInTimeZone, amountToCents, shouldCrossCheckCurrentSummary } from './calendar-core.mjs';
import { renderCalendarPng } from './calendar-render.mjs';

function parseArgs(argv) {
  const options = { keepSvg: false, fixture: null, dataOut: null, month: null, asOf: null, output: null, shopName: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--keep-svg') options.keepSvg = true;
    else if (['--month', '--as-of', '--output', '--fixture', '--data-out', '--shop-name'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new PosterError('MISSING_ARGUMENT', `${arg} 缺少参数`);
      const key = { '--month': 'month', '--as-of': 'asOf', '--output': 'output', '--fixture': 'fixture', '--data-out': 'dataOut', '--shop-name': 'shopName' }[arg];
      options[key] = value;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log('用法：node scripts/generate-calendar.mjs [--month YYYY-MM] [--as-of YYYY-MM-DD] [--shop-name 店铺名] --output /path/poster.png [--keep-svg] [--data-out /path/data.json] [--fixture /path/raw.json]');
      process.exit(0);
    } else throw new PosterError('UNKNOWN_ARGUMENT', `未知参数：${arg}`);
  }
  return options;
}

function runAilitJson(args) {
  const result = spawnSync('ailit', [...args, '--format', 'json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error?.code === 'ENOENT') throw new PosterError('AILIT_MISSING', '未找到 ailit CLI');
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || '').trim().replace(/\s+/g, ' ');
    throw new PosterError('AILIT_FAILED', `ailit ${args.slice(0, 2).join(' ')} 失败：${message}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new PosterError('AILIT_JSON', `ailit ${args.slice(0, 2).join(' ')} 返回了无效 JSON`);
  }
}

function fetchPaged(baseArgs, start, end) {
  const rows = [];
  const seen = new Set();
  let page = 1;
  let expectedTotal = null;
  while (true) {
    const response = runAilitJson([...baseArgs, '-s', start, '-e', end, '-p', String(page), '-z', '100']);
    if (!response || !Number.isInteger(response.total) || !Array.isArray(response.list)) throw new PosterError('PAGINATION_SHAPE', `${baseArgs.join(' ')} 分页结构异常`);
    if (expectedTotal === null) expectedTotal = response.total;
    if (response.total !== expectedTotal) throw new PosterError('PAGINATION_CHANGED', `${baseArgs.join(' ')} 拉取过程中 total 发生变化`);
    for (const row of response.list) {
      if (row?.id !== undefined && row?.id !== null) {
        const id = String(row.id);
        if (seen.has(id)) throw new PosterError('PAGINATION_DUPLICATE', `${baseArgs.join(' ')} 跨页出现重复 id：${id}`);
        seen.add(id);
      }
      rows.push(row);
    }
    if (rows.length >= expectedTotal) break;
    if (response.list.length === 0) throw new PosterError('PAGINATION_INCOMPLETE', `${baseArgs.join(' ')} 分页提前结束`);
    page += 1;
    if (page > 10000) throw new PosterError('PAGINATION_LIMIT', `${baseArgs.join(' ')} 分页超过安全上限`);
  }
  if (rows.length !== expectedTotal) throw new PosterError('PAGINATION_COUNT', `${baseArgs.join(' ')} 期望 ${expectedTotal} 条，实际 ${rows.length} 条`);
  return rows;
}

function fetchSources(range) {
  return {
    sales: fetchPaged(['sale', 'list'], range.start, range.end),
    receipts: fetchPaged(['receipt', 'list'], range.start, range.end),
    returns: fetchPaged(['sale', 'return-list'], range.start, range.end)
  };
}

function currentSalePayCents(sales) {
  return sales
    .filter((row) => row?.status === 'NORMAL' && row?.is_invalid === false)
    .reduce((sum, row) => sum + amountToCents(row.bill_pay_amt, '销售单.bill_pay_amt'), 0);
}

function liveInput(month, asOf) {
  const doctor = runAilitJson(['doctor']);
  if (doctor.allPass !== true) throw new PosterError('AILIT_UNHEALTHY', 'ailit doctor 检查未全部通过');
  const auth = runAilitJson(['auth', 'status']);
  if (!auth.defaultShop && !auth.merchant) throw new PosterError('SHOP_MISSING', 'ailit 未返回默认店铺');
  const ranges = collectionRanges(month, asOf);
  const currentSources = fetchSources(ranges.current);
  const previousSources = fetchSources(ranges.previous);
  if (shouldCrossCheckCurrentSummary({ ranges, asOf, today: todayInTimeZone(), currentSources })) {
    const report = runAilitJson(['report', 'all']);
    const expected = amountToCents(report?.month?.total_pay, 'report all.month.total_pay');
    const actual = currentSalePayCents(currentSources.sales);
    if (Math.abs(expected - actual) > 1) throw new PosterError('CROSS_CHECK_FAILED', `本月即时实收与综合报表相差 ${formatMoney(Math.abs(expected - actual), true)}`);
  }
  return { shopName: auth.defaultShop || auth.merchant, currentSources, previousSources, fetchedAt: new Date().toISOString() };
}

function fixtureInput(path) {
  const parsed = JSON.parse(readFileSync(resolve(path), 'utf8'));
  for (const key of ['shopName', 'currentSources', 'previousSources']) {
    if (parsed[key] === undefined) throw new PosterError('FIXTURE_INVALID', `fixture 缺少 ${key}`);
  }
  return parsed;
}

function defaultOutput(month) {
  return resolve(process.cwd(), '经营海报输出', `经营日历-${month}.png`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const asOf = options.asOf || todayInTimeZone();
  const month = options.month || asOf.slice(0, 7);
  const input = options.fixture ? fixtureInput(options.fixture) : liveInput(month, asOf);
  if (options.shopName) input.shopName = options.shopName;
  const model = buildCalendarModel({ month, asOf, ...input });
  const output = resolve(options.output || defaultOutput(month));
  const artifacts = await renderCalendarPng(model, output, { keepSvg: options.keepSvg });
  if (options.dataOut) {
    const dataPath = resolve(options.dataOut);
    mkdirSync(dirname(dataPath), { recursive: true });
    writeFileSync(dataPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify({
    ok: true,
    output: artifacts.png,
    svg: artifacts.svg,
    period: model.period.month,
    shop: model.shop.name,
    total: formatMoney(model.metrics.total_cents, true),
    collection_days: model.metrics.collection_days,
    comparison_rate: model.comparison.rate
  }, null, 2));
}

try {
  await main();
} catch (error) {
  const payload = error instanceof PosterError
    ? { ok: false, code: error.code, error: error.message, details: error.details }
    : { ok: false, code: 'UNEXPECTED', error: error?.message || String(error) };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}
