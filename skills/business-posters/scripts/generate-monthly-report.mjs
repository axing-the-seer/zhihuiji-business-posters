#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  PosterError,
  amountToCents,
  collectionRanges,
  formatMoney,
  todayInTimeZone
} from './calendar-core.mjs';
import { buildMonthlyReportModel, standardizeInventoryRisks } from './monthly-report-core.mjs';
import { renderMonthlyReportPngSet } from './monthly-report-render.mjs';

function parseArgs(argv) {
  const options = {
    keepSvg: false,
    month: null,
    asOf: null,
    outputDir: null,
    dataOut: null,
    previewData: null,
    shopName: null,
    page2Variant: 'clean'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--keep-svg') options.keepSvg = true;
    else if (['--month', '--as-of', '--output-dir', '--data-out', '--preview-data', '--shop-name', '--page2-variant'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new PosterError('MISSING_ARGUMENT', `${arg} 缺少参数`);
      const key = {
        '--month': 'month',
        '--as-of': 'asOf',
        '--output-dir': 'outputDir',
        '--data-out': 'dataOut',
        '--preview-data': 'previewData',
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

function runAilitJson(args) {
  const result = spawnSync('ailit', [...args, '--format', 'json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error?.code === 'ENOENT') throw new PosterError('AILIT_MISSING', '未找到 ailit CLI');
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || '').trim().replace(/\s+/g, ' ');
    throw new PosterError('AILIT_FAILED', `ailit ${args.slice(0, 3).join(' ')} 失败：${message}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new PosterError('AILIT_JSON', `ailit ${args.slice(0, 3).join(' ')} 返回了无效 JSON`);
  }
}

function stableId(row) {
  for (const field of ['id', 'product_id', 'company_id', 'operator_id']) {
    if (row?.[field] !== undefined && row?.[field] !== null) return `${field}:${row[field]}`;
  }
  return null;
}

function fetchPaged(baseArgs, { start = null, end = null } = {}) {
  const rows = [];
  const seen = new Set();
  let page = 1;
  let expectedTotal = null;
  while (true) {
    const args = [...baseArgs];
    if (start && end) args.push('-s', start, '-e', end);
    args.push('-p', String(page), '-z', '100');
    const response = runAilitJson(args);
    if (!response || !Number.isInteger(response.total) || !Array.isArray(response.list)) {
      throw new PosterError('PAGINATION_SHAPE', `${baseArgs.join(' ')} 分页结构异常`);
    }
    if (expectedTotal === null) expectedTotal = response.total;
    if (response.total !== expectedTotal) throw new PosterError('PAGINATION_CHANGED', `${baseArgs.join(' ')} 拉取过程中 total 发生变化`);
    for (const row of response.list) {
      const id = stableId(row);
      if (id && seen.has(id)) throw new PosterError('PAGINATION_DUPLICATE', `${baseArgs.join(' ')} 跨页出现重复 ${id}`);
      if (id) seen.add(id);
      rows.push(row);
    }
    if (rows.length >= expectedTotal) break;
    if (response.list.length === 0) throw new PosterError('PAGINATION_INCOMPLETE', `${baseArgs.join(' ')} 分页提前结束`);
    page += 1;
    if (page > 10000) throw new PosterError('PAGINATION_LIMIT', `${baseArgs.join(' ')} 分页超过安全上限`);
  }
  if (rows.length !== expectedTotal) throw new PosterError('PAGINATION_COUNT', `${baseArgs.join(' ')} 期望 ${expectedTotal} 条，实际 ${rows.length} 条`);
  return { rows, total: expectedTotal };
}

function fetchPeriod(range) {
  const date = { start: range.start, end: range.end };
  const receiptRows = fetchPaged(['receipt', 'list'], date).rows.map((row) => {
    const detail = runAilitJson(['receipt', 'get', String(row.id)]);
    if (!detail?.base || !Array.isArray(detail.items)) {
      throw new PosterError('RECEIPT_DETAIL_SHAPE', `收款单 ${row.id} 详情缺少 base/items`);
    }
    if (String(detail.base.id) !== String(row.id)
      || detail.base.bill_date !== row.bill_date
      || Math.abs(amountToCents(detail.base.total_amt, '收款单详情.total_amt') - amountToCents(row.total_amt, '收款单列表.total_amt')) > 1) {
      throw new PosterError('RECEIPT_DETAIL_MISMATCH', `收款单 ${row.id} 列表与详情不一致`);
    }
    if (amountToCents(detail.base.preferential_amt, '收款单详情.preferential_amt') !== 0
      || amountToCents(detail.base.prepaid_amt, '收款单详情.prepaid_amt') !== 0) {
      throw new PosterError('RECEIPT_PREFERENTIAL_UNVERIFIED', `收款单 ${row.id} 存在优惠或预存款抵扣，当前真实契约尚未覆盖`);
    }
    const accountTotal = detail.items.reduce(
      (sum, item) => sum + amountToCents(item.amt, '收款单账户明细.amt'),
      0
    );
    if (Math.abs(accountTotal - amountToCents(row.total_amt, '收款单列表.total_amt')) > 1) {
      throw new PosterError('RECEIPT_ACCOUNT_MISMATCH', `收款单 ${row.id} 账户明细与收款金额不一致`);
    }
    return { ...row, receipt_accounts: detail.items };
  });
  return {
    billStats: fetchPaged(['report', 'sale-stat', 'bill'], date).rows,
    sales: fetchPaged(['sale', 'list'], date).rows,
    receipts: receiptRows,
    returns: fetchPaged(['sale', 'return-list'], date).rows,
    fundProfit: runAilitJson(['report', 'fund-profit', '-s', range.start, '-e', range.end]),
    purchaseBills: fetchPaged(['purchase', 'list'], date).rows,
    purchase: runAilitJson(['report', 'purchase-stat', '-s', range.start, '-e', range.end, '-p', '1', '-z', '100']),
    products: fetchPaged(['report', 'sale-stat', 'product'], date).rows,
    customers: fetchPaged(['report', 'sale-stat', 'customer'], date).rows,
    operators: fetchPaged(['report', 'operator-achieve'], date).rows
  };
}

function liveInput(month, asOf) {
  const doctor = runAilitJson(['doctor']);
  if (doctor.allPass !== true) throw new PosterError('AILIT_UNHEALTHY', 'ailit doctor 检查未全部通过');
  const auth = runAilitJson(['auth', 'status']);
  const shopName = auth.defaultShop || auth.merchant;
  if (!shopName) throw new PosterError('SHOP_MISSING', 'ailit 未返回默认店铺');
  const ranges = collectionRanges(month, asOf);
  const current = fetchPeriod(ranges.current);
  const previous = fetchPeriod(ranges.previous);
  const debt = fetchPaged(['customer', 'debt']);
  const lowStock = runAilitJson(['stock', 'low', '--threshold', '5']);
  const outOfStock = runAilitJson(['stock', 'out']);
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

function previewModel(path, month, asOf) {
  const data = JSON.parse(readFileSync(resolve(path), 'utf8'));
  const kpi = data.kpis;
  const daily = data.daily;
  const clip = (value, max = 12) => {
    const chars = Array.from(String(value ?? ''));
    return chars.length <= max ? chars.join('') : `${chars.slice(0, Math.max(1, max - 1)).join('')}…`;
  };
  const previousDays = daily.slice(0, 30);
  const previousWeight = previousDays.reduce((sum, row) => sum + row.total_amt_cents, 0) || 1;
  let cumulative = 0;
  let previousCumulative = 0;
  const series = daily.map((row, index) => {
    cumulative += row.total_amt_cents;
    if (index < 30) {
      const amount = index === 29
        ? kpi.previous_sales_amount_cents - previousCumulative
        : Math.round(row.total_amt_cents / previousWeight * kpi.previous_sales_amount_cents);
      previousCumulative += amount;
    }
    return {
      day: index + 1,
      date: row.bill_date,
      sales_cents: row.total_amt_cents,
      cumulative_cents: cumulative,
      previous_cumulative_cents: previousCumulative
    };
  });
  const primary = [...data.products].sort((a, b) => b.total_amt_cents - a.total_amt_cents)[0];
  const debts = [...data.customer_debt].sort((a, b) => b.cur_amt_cents - a.cur_amt_cents);
  const debtTotal = debts.reduce((sum, row) => sum + row.cur_amt_cents, 0);
  const channelShares = [0.46, 0.28, 0.17, 0.09];
  const channelNames = ['微信支付', '支付宝', '现金收款', '银行卡'];
  let allocated = 0;
  const channels = channelShares.map((share, index) => {
    const amount = index === channelShares.length - 1
      ? kpi.actual_receipts_cents - allocated
      : Math.round(kpi.actual_receipts_cents * share);
    allocated += amount;
    return { name: channelNames[index], amount_cents: amount, share: amount / kpi.actual_receipts_cents };
  });
  const salesRate = kpi.previous_sales_amount_cents === 0 ? null : kpi.sales_amount_cents / kpi.previous_sales_amount_cents - 1;
  const compare = (current, previous) => ({ current, previous, delta: current - previous, rate: previous === 0 ? null : current / previous - 1 });
  const productMap = (row) => ({
    id: row.product_name,
    name: row.product_name,
    unit: row.main_unit_name,
    quantity: row.product_count,
    sales_cents: row.total_amt_cents,
    cost_cents: row.cost_amt_cents,
    profit_cents: row.profit_amt_cents,
    profit_rate: row.profit_rate
  });
  const inventoryRisks = standardizeInventoryRisks(
    data.stock_low.map((row) => ({ id: row.id == null ? null : String(row.id), name: row.name, stock: row.cur_stock, unit: row.unit_name, cost_cents: row.cost_prc_cents })),
    data.stock_out.map((row) => ({ id: row.id == null ? null : String(row.id), name: row.name, stock: row.cur_stock, unit: row.unit_name, cost_cents: row.cost_prc_cents }))
  );
  return {
    schema_version: 1,
    poster_type: 'monthly_business_report',
    page_count: 3,
    period: {
      month,
      year: Number(month.slice(0, 4)),
      month_number: Number(month.slice(5, 7)),
      start: data.meta.period_start,
      end: data.meta.period_end,
      as_of: asOf,
      comparison_start: '2026-06-01',
      comparison_end: '2026-06-30',
      relation: 'historical',
      calendar_days: daily.length
    },
    shop: { name: data.store.name },
    currency: 'CNY',
    overview: {
      sales_cents: kpi.sales_amount_cents,
      receipts_cents: kpi.actual_receipts_cents,
      receipt_rate: kpi.actual_receipts_cents / kpi.sales_amount_cents,
      total_income_cents: kpi.total_income_cents,
      total_expense_cents: kpi.total_expense_cents,
      operating_profit_cents: kpi.operating_profit_cents,
      profit_rate: kpi.operating_profit_cents / kpi.sales_amount_cents,
      order_count: kpi.sales_bill_count,
      outstanding_cents: kpi.sales_amount_cents - kpi.actual_receipts_cents
    },
    comparison: {
      sales: compare(kpi.sales_amount_cents, kpi.previous_sales_amount_cents),
      receipts: compare(kpi.actual_receipts_cents, kpi.previous_actual_receipts_cents),
      profit: compare(kpi.operating_profit_cents, kpi.previous_operating_profit_cents),
      expenses: compare(kpi.total_expense_cents, kpi.previous_sales_amount_cents - kpi.previous_operating_profit_cents),
      orders: compare(kpi.sales_bill_count, kpi.previous_sales_bill_count)
    },
    purchase: {
      total_amount_cents: kpi.purchase_amount_cents,
      total_quantity: kpi.purchase_product_count,
      order_count: kpi.purchase_bill_count,
      row_count: data.products.length
    },
    purchase_comparison: {
      amount: compare(kpi.purchase_amount_cents, kpi.previous_purchase_amount_cents),
      quantity: compare(kpi.purchase_product_count, kpi.previous_purchase_product_count),
      orders: compare(kpi.purchase_bill_count, kpi.previous_purchase_bill_count),
      products: compare(data.products.length, data.products.length)
    },
    daily: series,
    highest_day: daily.reduce((best, row) => !best || row.total_amt_cents > best.amount_cents ? { date: row.bill_date, amount_cents: row.total_amt_cents } : best, null),
    channels,
    products: {
      primary: { ...productMap(primary), sales_share: primary.total_amt_cents / kpi.sales_amount_cents },
      volume_top: [...data.products].sort((a, b) => b.product_count - a.product_count).slice(0, 5).map(productMap),
      profit_top: [...data.products].sort((a, b) => b.profit_amt_cents - a.profit_amt_cents).slice(0, 5).map(productMap)
    },
    customers: {
      sales_top: data.customer_sales.slice(0, 5).map((row, index) => ({
        id: String(index),
        name: row.company_name,
        kind: row.company_name === '零售散客' ? 'retail_walk_in' : row.company_name === '批发散客' ? 'wholesale_walk_in' : 'customer',
        quantity: row.sales,
        sales_cents: row.total_amt_cents,
        profit_cents: row.profit_amt_cents
      })),
      debt_top: debts.slice(0, 5).map((row, index) => ({ id: String(index), name: row.name, amount_cents: row.cur_amt_cents, last_bill_date: row.last_bill_date })),
      debt_total_count: debts.length,
      debt_total_cents: debtTotal
    },
    operators: {
      sales_top: data.operators.slice(0, 5).map((row, index) => ({ id: String(index), name: row.operator_name, quantity: row.sales, sales_cents: row.total_tamt_cents, profit_cents: row.profit_tamt_cents, profit_rate: row.cost_profit_ratio }))
    },
    risks: {
      low_stock: inventoryRisks.lowStock,
      out_of_stock: inventoryRisks.outOfStock,
      snapshot_as_of: data.meta.inventory_snapshot_as_of
    },
    insights: {
      headline: `本月销售较上月增长 ${(salesRate * 100).toFixed(1)}%，主力商品表现突出。`,
      primary_product: `「${primary.product_name}」贡献 ${(primary.total_amt_cents / kpi.sales_amount_cents * 100).toFixed(1)}% 销售额。`,
      risk: `${debts.length} 位客户有欠款，${data.stock_out.length} 款缺货需要跟进。`,
      leading_channel: `本月实收主要来自「${channels[0].name}」，占 ${(channels[0].share * 100).toFixed(1)}%。`,
      sales_change: `增长 ${(salesRate * 100).toFixed(1)}%`
    },
    actions: [
      `先跟进「${clip(debts[0].name)}」等重点欠款客户，加快资金回笼。`,
      `优先补齐「${clip(data.stock_out[0].name, 9)}」等缺货商品。`,
      `保持「${clip(primary.product_name)}」库存周转，同时关注利润表现。`
    ],
    quality: {
      status: 'ok',
      fetched_at: '2026-08-22T16:00:00+08:00',
      current_bill_count: kpi.sales_bill_count,
      current_sale_count: kpi.sales_bill_count,
      previous_bill_count: kpi.previous_sales_bill_count,
      previous_sale_count: kpi.previous_sales_bill_count,
      current_purchase_row_count: data.products.length,
      previous_purchase_row_count: data.products.length,
      warnings: ['synthetic_visual_preview']
    }
  };
}

function currentCrossCheck(model) {
  const report = runAilitJson(['report', 'all']);
  const sales = amountToCents(report?.month?.total_amount, 'report all.month.total_amount');
  const orders = Number(report?.month?.total_sales);
  if (!Number.isInteger(orders)) throw new PosterError('CROSS_CHECK_SHAPE', 'report all.month.total_sales 不是整数');
  if (Math.abs(sales - model.overview.sales_cents) > 1) throw new PosterError('CROSS_CHECK_FAILED', `销售额与综合报表相差 ${formatMoney(Math.abs(sales - model.overview.sales_cents), true)}`);
  if (orders !== model.overview.order_count) throw new PosterError('CROSS_CHECK_FAILED', `销售单数与综合报表相差 ${Math.abs(orders - model.overview.order_count)} 单`);
  const pay = amountToCents(report?.month?.total_pay, 'report all.month.total_pay');
  if (Math.abs(pay - model.overview.receipts_cents) > 1) throw new PosterError('CROSS_CHECK_FAILED', `实收金额与综合报表相差 ${formatMoney(Math.abs(pay - model.overview.receipts_cents), true)}`);
}

function defaultOutputDir(month) {
  return resolve(process.cwd(), '经营海报输出', `经营月报-${month}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!['clean', 'compare'].includes(options.page2Variant)) throw new PosterError('INVALID_ARGUMENT', '--page2-variant 只支持 clean 或 compare');
  const asOf = options.asOf || todayInTimeZone();
  const month = options.month || asOf.slice(0, 7);
  let model;
  if (options.previewData) {
    model = previewModel(options.previewData, month, asOf);
  } else {
    const input = liveInput(month, asOf);
    model = buildMonthlyReportModel({ month, asOf, ...input });
    if (model.period.relation === 'current' && asOf === todayInTimeZone() && input.current.receipts.length === 0 && input.current.returns.length === 0) {
      currentCrossCheck(model);
    }
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
    page_count: artifacts.length,
    outputs: artifacts.map((artifact) => artifact.png),
    sales: formatMoney(model.overview.sales_cents, true),
    receipts: formatMoney(model.overview.receipts_cents, true),
    operating_profit: formatMoney(model.overview.operating_profit_cents, true)
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
