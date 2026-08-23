#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { todayInTimeZone } from '../scripts/calendar-core.mjs';
import { standardizeInventoryRisks } from '../scripts/monthly-report-core.mjs';
import { renderMonthlyReportPngSet } from '../scripts/monthly-report-render.mjs';

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


function parseArgs(argv) {
  const options = { previewData: null, month: null, asOf: null, outputDir: null, shopName: null, page2Variant: 'clean' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (['--preview-data', '--month', '--as-of', '--output-dir', '--shop-name', '--page2-variant'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少参数`);
      options[{ '--preview-data': 'previewData', '--month': 'month', '--as-of': 'asOf', '--output-dir': 'outputDir', '--shop-name': 'shopName', '--page2-variant': 'page2Variant' }[arg]] = value;
      index += 1;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (!options.previewData) throw new Error('--preview-data 为必填参数');
  if (!options.outputDir) throw new Error('--output-dir 为必填参数');
  return options;
}

const options = parseArgs(process.argv.slice(2));
const asOf = options.asOf || todayInTimeZone();
const month = options.month || asOf.slice(0, 7);
const model = previewModel(options.previewData, month, asOf);
if (options.shopName) model.shop.name = options.shopName;
const artifacts = await renderMonthlyReportPngSet(model, resolve(options.outputDir), { page2Variant: options.page2Variant });
console.log(JSON.stringify({ ok: true, development_preview: true, outputs: artifacts.map((item) => item.png) }, null, 2));
