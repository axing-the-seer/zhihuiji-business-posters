import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMonthlyReportModel, standardizeInventoryRisks } from '../scripts/monthly-report-core.mjs';
import { renderMonthlyReportPngSet, renderMonthlyReportSvgs } from '../scripts/monthly-report-render.mjs';

function period({ date, sales = 100, paid = 80, expense = 60, purchase = 50 } = {}) {
  const product = sales > 0 ? [{
    product_id: 'p1', product_name: '很长的测试商品名称用于验证手机端省略', main_unit_name: '件',
    product_count: 2, total_amt: sales, cost_amt: expense, profit_amt: sales - expense, profit_rate: (sales - expense) / sales
  }] : [];
  const customer = sales > 0 ? [{ company_id: 'c1', company_name: '测试客户', sales: 2, total_amt: sales, profit_amt: sales - expense }] : [];
  const operator = sales > 0 ? [{ operator_id: 'o1', operator_name: '测试员工', sales: 2, total_tamt: sales, profit_tamt: sales - expense, cost_profit_ratio: 0.4 }] : [];
  const saleRows = sales > 0 ? [{
    id: `s-${date}`, bill_date: date, status: 'NORMAL', is_invalid: false,
    bill_pay_amt: paid, owe_amt: sales - paid, acct_name: '微信支付'
  }] : [];
  return {
    billStats: sales > 0 ? [{ bill_date: date, total_amt: sales }] : [],
    sales: saleRows,
    receipts: [],
    returns: [],
    fundProfit: { sale_in: sales, sum_in_v2: sales, sum_out_v2: expense, sum_profit_v2: sales - expense },
    purchase: { total: purchase > 0 ? 1 : 0, list: purchase > 0 ? [{ synthetic: true }] : [], sum_total_amt: purchase, sum_product_count: purchase > 0 ? 5 : 0, sum_purs: purchase > 0 ? 1 : 0 },
    products: product,
    customers: customer,
    operators: operator
  };
}

function input(overrides = {}) {
  return {
    month: '2026-07',
    asOf: '2026-07-31',
    shopName: '手机阅读测试店铺',
    fetchedAt: '2026-08-22T16:00:00+08:00',
    current: period({ date: '2026-07-01' }),
    previous: period({ date: '2026-06-01', sales: 80, paid: 70, expense: 50, purchase: 40 }),
    snapshots: { debts: { total: 0, rows: [] }, lowStock: [], outOfStock: [] },
    ...overrides
  };
}

test('月报模型使用已验证的利润与进货汇总字段', () => {
  const model = buildMonthlyReportModel(input());
  assert.equal(model.page_count, 3);
  assert.equal(model.overview.sales_cents, 10000);
  assert.equal(model.overview.total_income_cents, 10000);
  assert.equal(model.overview.total_expense_cents, 6000);
  assert.equal(model.overview.operating_profit_cents, 4000);
  assert.equal(model.purchase.total_amount_cents, 5000);
  assert.equal(model.purchase.total_quantity, 5);
  assert.equal(model.purchase.order_count, 1);
  assert.equal(model.channels[0].name, '微信支付');
});

test('真实收款单金额和账户明细进入实收与渠道', () => {
  const current = period({ date: '2026-07-01', sales: 100, paid: 80, expense: 60 });
  current.receipts = [{
    id: 'r1',
    bill_date: '2026-07-02',
    total_amt: 20,
    status: 1,
    receipt_accounts: [{ acct_name: '现金', amt: 20 }]
  }];
  const model = buildMonthlyReportModel(input({ current }));
  assert.equal(model.overview.receipts_cents, 10000);
  assert.deepEqual(model.channels.map((row) => [row.name, row.amount_cents]), [
    ['微信支付', 8000],
    ['现金', 2000]
  ]);
});

test('月报拒绝未知收款状态和本期或对比期退货', () => {
  const unknownReceipt = period({ date: '2026-07-01' });
  unknownReceipt.receipts = [{ id: 'r1', bill_date: '2026-07-02', total_amt: 20, status: 2, receipt_accounts: [] }];
  assert.throws(() => buildMonthlyReportModel(input({ current: unknownReceipt })), (error) => error.code === 'RECEIPT_STATUS_UNVERIFIED');

  const currentReturn = period({ date: '2026-07-01' });
  currentReturn.returns = [{ id: 'rt1', bill_date: '2026-07-03', pay_amt: 10 }];
  assert.throws(() => buildMonthlyReportModel(input({ current: currentReturn })), (error) => error.code === 'SALES_RETURN_UNVERIFIED');

  const previousReturn = period({ date: '2026-06-01', sales: 80, paid: 70, expense: 50, purchase: 40 });
  previousReturn.returns = [{ id: 'rt2', bill_date: '2026-06-03', pay_amt: 10 }];
  assert.throws(() => buildMonthlyReportModel(input({ previous: previousReturn })), (error) => error.code === 'SALES_RETURN_UNVERIFIED');
});

test('库存用唯一名称补齐商品 ID，负库存后台保留但页面值仍为零', () => {
  const risks = standardizeInventoryRisks([
    { id: 'p1', name: '合成商品A', stock: 3, unit: '件', cost_cents: 100 },
    { id: null, name: '合成商品B', stock: 2, unit: '件', cost_cents: 200 }
  ], [
    { id: null, name: '合成商品A', stock: -2, unit: '件', cost_cents: 100 },
    { id: 'p2', name: '合成商品B', stock: 0, unit: '件', cost_cents: 200 }
  ]);
  assert.deepEqual(risks.lowStock, []);
  assert.deepEqual(risks.outOfStock.map((row) => [row.name, row.stock, row.raw_stock, row.warning]), [
    ['合成商品A', 0, -2, 'negative_stock'],
    ['合成商品B', 0, 0, null]
  ]);
});

test('利润关系不一致时停止生成', () => {
  const current = period({ date: '2026-07-01' });
  current.fundProfit.sum_profit_v2 = 39;
  assert.throws(() => buildMonthlyReportModel(input({ current })), (error) => error.code === 'CROSS_CHECK_FAILED');
});

test('进货字段缺失时不将失败渲染为零', () => {
  const current = period({ date: '2026-07-01' });
  delete current.purchase.sum_product_count;
  assert.throws(() => buildMonthlyReportModel(input({ current })), (error) => error.code === 'UNSUPPORTED_SOURCE_FIELDS');
});

test('真实零数据保留明确零状态并可渲染三页', async () => {
  const current = period({ date: '2026-07-01', sales: 0, paid: 0, expense: 0, purchase: 0 });
  const previous = period({ date: '2026-06-01', sales: 0, paid: 0, expense: 0, purchase: 0 });
  const model = buildMonthlyReportModel(input({ current, previous }));
  assert.equal(model.overview.sales_cents, 0);
  assert.equal(model.overview.receipt_rate, null);
  assert.equal(model.highest_day.date, null);
  assert.equal(model.purchase.total_amount_cents, 0);
  const pages = renderMonthlyReportSvgs(model);
  assert.deepEqual(pages.map((page) => page.title), ['经营概览', '商品与库存', '收款与客户']);
  assert.match(pages[0].svg, /本月销售额为 0/);
  assert.match(pages[1].svg, /本月无进货记录/);
  const directory = mkdtempSync(join(tmpdir(), 'monthly-report-test-'));
  try {
    const artifacts = await renderMonthlyReportPngSet(model, directory);
    assert.equal(artifacts.length, 3);
    assert.match(artifacts[0].png, /01-经营概览\.png$/);
    assert.match(artifacts[1].png, /02-商品与库存\.png$/);
    assert.match(artifacts[2].png, /03-收款与客户\.png$/);
    for (const artifact of artifacts) {
      const png = readFileSync(artifact.png);
      assert.equal(png.readUInt32BE(16), 1080);
      assert.equal(png.readUInt32BE(20), 1620);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
