#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  PosterError,
  amountToCents,
  collectionRanges,
  formatMoney,
  todayInTimeZone
} from './calendar-core.mjs';
import { buildMonthlyReportModel } from './monthly-report-core.mjs';
import { renderMonthlyReportPngSet } from './monthly-report-render.mjs';
import {
  assertNoUnverifiedReturns,
  ensureAilitHealthy,
  fetchPaged,
  fetchValidatedReceipts,
  runAilitJson,
  sanitizeCliError
} from './ailit-runtime.mjs';

function parseArgs(argv) {
  const options = {
    keepSvg: false,
    month: null,
    asOf: null,
    outputDir: null,
    dataOut: null,
    shopName: null,
    page2Variant: 'clean'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--keep-svg') options.keepSvg = true;
    else if (['--month', '--as-of', '--output-dir', '--data-out', '--shop-name', '--page2-variant'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new PosterError('MISSING_ARGUMENT', `${arg} 缺少参数`);
      const key = {
        '--month': 'month',
        '--as-of': 'asOf',
        '--output-dir': 'outputDir',
        '--data-out': 'dataOut',
        '--shop-name': 'shopName',
        '--page2-variant': 'page2Variant'
      }[arg];
      options[key] = value;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log('用法：node scripts/generate-monthly-report.mjs [--month YYYY-MM] [--as-of YYYY-MM-DD] [--shop-name 店铺名] [--page2-variant clean|compare] [--output-dir /absolute/dir] [--keep-svg] [--data-out /absolute/model.json]');
      process.exit(0);
    } else throw new PosterError('UNKNOWN_ARGUMENT', `未知参数：${arg}`);
  }
  return options;
}

function userMessageFor(error) {
  const code = error instanceof PosterError ? error.code : 'UNEXPECTED';
  if (code === 'AILIT_MISSING' || code === 'RENDERER_MISSING') return '经营海报服务尚未完成初始化，请重新安装或连接“经营海报”后再试。';
  if (code === 'SHOP_MISSING') return '当前还没有选择经营店铺，请先在智慧记中选择店铺。';
  if (code === 'SALES_RETURN_UNVERIFIED') return '本月或对比月份存在销售退货，当前版本暂时无法准确计入。为避免金额错误，本次没有生成经营月报。';
  if (code.startsWith('RECEIPT_')) return '部分收款记录暂时无法准确核对。为避免金额错误，本次没有生成经营月报。';
  if (['MISSING_ARGUMENT', 'UNKNOWN_ARGUMENT', 'INVALID_ARGUMENT', 'INVALID_MONTH', 'FUTURE_MONTH'].includes(code)) {
    return error.message;
  }
  if (code.startsWith('AILIT_')) return '智慧记数据暂时读取失败，请稍后重试。';
  if (code.startsWith('PAGINATION_')
    || code.startsWith('CROSS_CHECK_')
    || code.endsWith('_SHAPE')
    || code.endsWith('_MISMATCH')
    || code === 'UNSUPPORTED_SOURCE_FIELDS') {
    return '部分经营数据未通过一致性检查，为避免生成错误月报，本次没有出图。';
  }
  return '经营月报生成失败，请稍后重新生成。';
}

function fetchPeriod(range) {
  const date = { start: range.start, end: range.end };
  const returns = fetchPaged(['sale', 'return-list'], { ...date, label: '销售退货单' }).rows;
  assertNoUnverifiedReturns(returns, '所选月份');
  return {
    billStats: fetchPaged(['report', 'sale-stat', 'bill'], { ...date, label: '销售趋势' }).rows,
    sales: fetchPaged(['sale', 'list'], { ...date, label: '销售单' }).rows,
    receipts: fetchValidatedReceipts(range),
    returns,
    fundProfit: runAilitJson(['report', 'fund-profit', '-s', range.start, '-e', range.end], { label: '经营利润' }),
    purchaseBills: fetchPaged(['purchase', 'list'], { ...date, label: '进货单' }).rows,
    purchase: runAilitJson(['report', 'purchase-stat', '-s', range.start, '-e', range.end, '-p', '1', '-z', '100'], { label: '进货统计' }),
    products: fetchPaged(['report', 'sale-stat', 'product'], { ...date, label: '商品销售统计' }).rows,
    customers: fetchPaged(['report', 'sale-stat', 'customer'], { ...date, label: '客户销售统计' }).rows,
    operators: fetchPaged(['report', 'operator-achieve'], { ...date, label: '员工业绩' }).rows
  };
}

function liveInput(month, asOf) {
  ensureAilitHealthy();
  const auth = runAilitJson(['auth', 'status']);
  const shopName = auth.defaultShop || auth.merchant;
  if (!shopName) throw new PosterError('SHOP_MISSING', 'ailit 未返回默认店铺');
  const ranges = collectionRanges(month, asOf);
  const current = fetchPeriod(ranges.current);
  const previous = fetchPeriod(ranges.previous);
  const debt = fetchPaged(['customer', 'debt'], { label: '客户欠款' });
  const lowStock = runAilitJson(['stock', 'low', '--threshold', '5'], { label: '低库存' });
  const outOfStock = runAilitJson(['stock', 'out'], { label: '缺货商品' });
  if (!Array.isArray(lowStock) || !Array.isArray(outOfStock)) throw new PosterError('STOCK_SHAPE', '库存风险命令返回结构异常');
  return {
    shopName,
    fetchedAt: new Date().toISOString(),
    current,
    previous,
    snapshots: {
      debts: { rows: debt.rows, total: debt.total },
      lowStock,
      outOfStock
    }
  };
}

function currentCrossCheck(model, { checkReceipts }) {
  const report = runAilitJson(['report', 'all'], { label: '综合报表' });
  const sales = amountToCents(report?.month?.total_amount, 'report all.month.total_amount');
  const orders = Number(report?.month?.total_sales);
  if (!Number.isInteger(orders)) throw new PosterError('CROSS_CHECK_SHAPE', 'report all.month.total_sales 不是整数');
  if (Math.abs(sales - model.overview.sales_cents) > 1) throw new PosterError('CROSS_CHECK_FAILED', `销售额与综合报表相差 ${formatMoney(Math.abs(sales - model.overview.sales_cents), true)}`);
  if (orders !== model.overview.order_count) throw new PosterError('CROSS_CHECK_FAILED', `销售单数与综合报表相差 ${Math.abs(orders - model.overview.order_count)} 单`);
  if (checkReceipts) {
    const pay = amountToCents(report?.month?.total_pay, 'report all.month.total_pay');
    if (Math.abs(pay - model.overview.receipts_cents) > 1) throw new PosterError('CROSS_CHECK_FAILED', `实收金额与综合报表相差 ${formatMoney(Math.abs(pay - model.overview.receipts_cents), true)}`);
  }
}

function defaultOutputDir(month) {
  return resolve(process.cwd(), '经营海报输出', `经营月报-${month}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!['clean', 'compare'].includes(options.page2Variant)) throw new PosterError('INVALID_ARGUMENT', '--page2-variant 只支持 clean 或 compare');
  const asOf = options.asOf || todayInTimeZone();
  const month = options.month || asOf.slice(0, 7);
  const input = liveInput(month, asOf);
  const model = buildMonthlyReportModel({ month, asOf, ...input });
  if (model.period.relation === 'current' && asOf === todayInTimeZone()) {
    currentCrossCheck(model, {
      checkReceipts: input.current.receipts.length === 0 && input.current.returns.length === 0
    });
  }
  if (options.shopName) model.shop.name = options.shopName;
  const outputDir = resolve(options.outputDir || defaultOutputDir(month));
  const artifacts = await renderMonthlyReportPngSet(model, outputDir, { keepSvg: options.keepSvg, page2Variant: options.page2Variant });
  if (options.dataOut) {
    const dataPath = resolve(options.dataOut);
    mkdirSync(dirname(dataPath), { recursive: true });
    writeFileSync(dataPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify({
    ok: true,
    poster_type: model.poster_type,
    period: model.period.month,
    as_of: model.period.as_of,
    page_count: artifacts.length,
    page_names: ['经营概览', '商品与库存', '收款与客户'],
    outputs: artifacts.map((artifact) => artifact.png),
    sales: formatMoney(model.overview.sales_cents, true),
    receipts: formatMoney(model.overview.receipts_cents, true),
    profit: formatMoney(model.overview.operating_profit_cents, true)
  }, null, 2));
}

try {
  await main();
} catch (error) {
  const payload = error instanceof PosterError
    ? { ok: false, code: error.code, user_message: userMessageFor(error), internal_error: sanitizeCliError(error.message), details: error.details }
    : { ok: false, code: 'UNEXPECTED', user_message: userMessageFor(error), internal_error: sanitizeCliError(error?.message || String(error)) };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}
