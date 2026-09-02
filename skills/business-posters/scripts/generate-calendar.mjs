#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PosterError, buildCalendarModel, collectionRanges, formatMoney, todayInTimeZone, amountToCents, shouldCrossCheckCurrentSummary } from './calendar-core.mjs';
import { renderCalendarPng } from './calendar-render.mjs';
import { preflightEnvironment } from './preflight.mjs';
import {
  assertNoUnverifiedReturns,
  fetchPaged,
  fetchValidatedReceipts,
  runAilitJson
} from './ailit-runtime.mjs';
import { userMessageFor } from './user-errors.mjs';

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

function fetchSources(range) {
  const returns = fetchPaged(['sale', 'return-list'], {
    start: range.start,
    end: range.end,
    label: '销售退货单'
  }).rows;
  assertNoUnverifiedReturns(returns, '所选月份');
  return {
    sales: fetchPaged(['sale', 'list'], {
      start: range.start,
      end: range.end,
      label: '销售单'
    }).rows,
    receipts: fetchValidatedReceipts(range),
    returns
  };
}

function currentSalePayCents(sales) {
  return sales
    .filter((row) => row?.status === 'NORMAL' && row?.is_invalid === false)
    .reduce((sum, row) => sum + amountToCents(row.bill_pay_amt, '销售单.bill_pay_amt'), 0);
}

function liveInput(month, asOf) {
  const auth = runAilitJson(['auth', 'status']);
  if (!auth.defaultShop && !auth.merchant) throw new PosterError('SHOP_MISSING', 'ailit 未返回默认店铺');
  const ranges = collectionRanges(month, asOf);
  const currentSources = fetchSources(ranges.current);
  const previousSources = fetchSources(ranges.previous);
  if (shouldCrossCheckCurrentSummary({ ranges, asOf, today: todayInTimeZone(), currentSources })) {
    const report = runAilitJson(['report', 'all'], { label: '综合报表' });
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
  const output = resolve(options.output || defaultOutput(month));
  const dataPath = options.dataOut ? resolve(options.dataOut) : null;
  const svgPath = options.keepSvg ? output.replace(/\.png$/i, '.svg') : null;
  for (const target of [output, svgPath, dataPath].filter(Boolean)) {
    if (existsSync(target)) throw new PosterError('OUTPUT_EXISTS', `目标位置已经存在同名文件：${target}`);
  }
  await preflightEnvironment({ requireAilit: !options.fixture });
  const input = options.fixture ? fixtureInput(options.fixture) : liveInput(month, asOf);
  if (options.shopName) input.shopName = options.shopName;
  const model = buildCalendarModel({ month, asOf, ...input });
  const artifacts = await renderCalendarPng(model, output, { keepSvg: options.keepSvg });
  if (dataPath) {
    mkdirSync(dirname(dataPath), { recursive: true });
    writeFileSync(dataPath, `${JSON.stringify(model, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  }
  console.log(JSON.stringify({
    ok: true,
    user_message: `${model.period.year}年${model.period.month_number}月经营日历已生成。`,
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
    ? { ok: false, user_message: userMessageFor(error, 'calendar') }
    : { ok: false, user_message: userMessageFor(error, 'calendar') };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}
