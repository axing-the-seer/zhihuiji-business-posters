import {
  PosterError,
  aggregateSources,
  amountToCents,
  collectionRanges,
  daysInMonth,
  formatMoney,
  isIsoDate,
  isoDate,
  parseMonth
} from './calendar-core.mjs';

const INVALID_STATUSES = new Set(['INVALID', 'VOID', 'CANCELLED', 'CANCELED', 'DELETED']);

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new PosterError('INVALID_SOURCE', `${label} 不是数组`);
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PosterError('INVALID_SOURCE', `${label} 不是对象`);
  return value;
}

function requiredField(row, field, label) {
  if (row?.[field] === undefined || row?.[field] === null || row?.[field] === '') {
    throw new PosterError('UNSUPPORTED_SOURCE_FIELDS', `${label} 缺少 ${field}`, {
      available_fields: Object.keys(row || {}).sort()
    });
  }
  return row[field];
}

function centsField(row, field, label) {
  return amountToCents(requiredField(row, field, label), `${label}.${field}`);
}

function numberField(row, field, label) {
  const value = Number(requiredField(row, field, label));
  if (!Number.isFinite(value)) throw new PosterError('INVALID_NUMBER', `${label}.${field} 不是有效数字`);
  return value;
}

function validSale(row) {
  if (row?.is_invalid === true) return false;
  const status = String(row?.status ?? '').toUpperCase();
  return status === 'NORMAL' && !INVALID_STATUSES.has(status);
}

function comparison(current, previous) {
  const delta = current - previous;
  return {
    current,
    previous,
    delta,
    rate: previous === 0 ? null : delta / previous
  };
}

function sortDesc(rows, accessor) {
  return [...rows].sort((a, b) => accessor(b) - accessor(a));
}

function safeText(value, fallback) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function clippedName(value, max = 12) {
  const chars = Array.from(safeText(value, '未命名'));
  return chars.length <= max ? chars.join('') : `${chars.slice(0, Math.max(1, max - 1)).join('')}…`;
}

function billDaily(rows, range, label) {
  const daily = new Map();
  for (const row of requireArray(rows, label)) {
    const date = String(requiredField(row, 'bill_date', label));
    if (!isIsoDate(date)) throw new PosterError('INVALID_SOURCE_DATE', `${label}.bill_date 不是 YYYY-MM-DD`);
    if (date < range.start || date > range.end) continue;
    const amount = centsField(row, 'total_amt', label);
    daily.set(date, (daily.get(date) || 0) + amount);
  }
  return daily;
}

function mapTotal(map) {
  let total = 0;
  for (const value of map.values()) total += value;
  return total;
}

function cumulativeSeries({ month, range, currentDaily, previousRange, previousDaily }) {
  const { year, month: monthNumber } = parseMonth(month);
  const currentEndDay = Number(range.end.slice(8, 10));
  const previousYear = Number(previousRange.start.slice(0, 4));
  const previousMonth = Number(previousRange.start.slice(5, 7));
  const previousEndDay = Number(previousRange.end.slice(8, 10));
  const points = [];
  let currentTotal = 0;
  let previousTotal = 0;
  for (let day = 1; day <= currentEndDay; day += 1) {
    const date = isoDate(year, monthNumber, day);
    currentTotal += currentDaily.get(date) || 0;
    if (day <= previousEndDay) {
      const previousDate = isoDate(previousYear, previousMonth, day);
      previousTotal += previousDaily.get(previousDate) || 0;
    }
    points.push({
      day,
      date,
      sales_cents: currentDaily.get(date) || 0,
      cumulative_cents: currentTotal,
      previous_cumulative_cents: previousTotal
    });
  }
  return points;
}

function normalizeProducts(rows, label) {
  return requireArray(rows, label).map((row) => ({
    id: String(requiredField(row, 'product_id', label)),
    name: safeText(requiredField(row, 'product_name', label), '未命名商品'),
    unit: safeText(row.main_unit_name, ''),
    quantity: numberField(row, 'product_count', label),
    sales_cents: centsField(row, 'total_amt', label),
    cost_cents: centsField(row, 'cost_amt', label),
    profit_cents: centsField(row, 'profit_amt', label),
    profit_rate: numberField(row, 'profit_rate', label)
  }));
}

function normalizeCustomers(rows, label) {
  return requireArray(rows, label).map((row) => {
    const name = safeText(requiredField(row, 'company_name', label), '未命名客户');
    const kind = name === '零售散客'
      ? 'retail_walk_in'
      : name === '批发散客'
        ? 'wholesale_walk_in'
        : 'customer';
    return {
      id: String(requiredField(row, 'company_id', label)),
      name,
      kind,
      quantity: numberField(row, 'sales', label),
      sales_cents: centsField(row, 'total_amt', label),
      profit_cents: centsField(row, 'profit_amt', label)
    };
  });
}

function normalizeOperators(rows, label) {
  return requireArray(rows, label).map((row) => ({
    id: String(requiredField(row, 'operator_id', label)),
    name: safeText(requiredField(row, 'operator_name', label), '未命名员工'),
    quantity: numberField(row, 'sales', label),
    sales_cents: centsField(row, 'total_tamt', label),
    profit_cents: centsField(row, 'profit_tamt', label),
    profit_rate: numberField(row, 'cost_profit_ratio', label)
  }));
}

function normalizeDebts(snapshot) {
  const source = requireObject(snapshot, '客户欠款');
  if (!Number.isInteger(source.total) || source.total < 0) {
    throw new PosterError('DEBT_SHAPE', '客户欠款.total 不是非负整数');
  }
  const rows = requireArray(source.rows, '客户欠款.rows').map((row) => ({
    id: row.id == null ? null : String(row.id),
    name: safeText(requiredField(row, 'name', '客户欠款'), '未命名客户'),
    amount_cents: centsField(row, 'cur_amt', '客户欠款'),
    last_bill_date: row.last_bill_date ? String(row.last_bill_date) : null
  }));
  return {
    total: source.total,
    rows: sortDesc(rows, (row) => row.amount_cents)
  };
}

function normalizeStock(rows, label) {
  return requireArray(rows, label).map((row) => ({
    id: row.id == null ? null : String(row.id),
    name: safeText(requiredField(row, 'name', label), '未命名商品'),
    stock: numberField(row, 'cur_stock', label),
    unit: safeText(row.unit_name, ''),
    cost_cents: centsField(row, 'cost_prc', label)
  }));
}

function stockIdentity(row) {
  if (row.id !== null && row.id !== undefined && String(row.id).trim()) return `id:${String(row.id).trim()}`;
  return `name:${safeText(row.name, '未命名商品').toLocaleLowerCase('zh-CN')}`;
}

function uniqueStockRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = stockIdentity(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function standardizeInventoryRisks(lowRows, outRows) {
  const combined = [...lowRows, ...outRows];
  const outOfStock = uniqueStockRows(combined.filter((row) => row.stock <= 0))
    .map((row) => ({ ...row, stock: 0 }));
  const outKeys = new Set(outOfStock.map(stockIdentity));
  const lowStock = uniqueStockRows(combined.filter((row) => row.stock > 0 && !outKeys.has(stockIdentity(row))));
  return {
    lowStock: sortDesc(lowStock, (row) => -row.stock),
    outOfStock
  };
}

function normalizePurchaseSummary(report, label) {
  const source = requireObject(report, label);
  if (!Number.isInteger(source.total) || !Array.isArray(source.list)) {
    throw new PosterError('PURCHASE_SHAPE', `${label} 缺少 total/list 分页结构`);
  }
  const totalAmount = centsField(source, 'sum_total_amt', label);
  const totalQuantity = numberField(source, 'sum_product_count', label);
  const orderCount = numberField(source, 'sum_purs', label);
  if (!Number.isInteger(orderCount)) throw new PosterError('PURCHASE_SHAPE', `${label}.sum_purs 不是整数`);
  if (totalAmount < 0 || totalQuantity < 0 || orderCount < 0) {
    throw new PosterError('NEGATIVE_PURCHASE', `${label} 汇总值不应为负数`);
  }
  return {
    total_amount_cents: totalAmount,
    total_quantity: totalQuantity,
    order_count: orderCount,
    row_count: source.total
  };
}

function channelBreakdown(sources, validSales) {
  const receipts = requireArray(sources.receipts, '收款单');
  const returns = requireArray(sources.returns, '销售退货单');
  if (returns.length) {
    throw new PosterError(
      'CHANNEL_CONTRACT_UNVERIFIED',
      '当前存在销售退款记录，但其退款账户字段尚无真实非空契约，已停止生成渠道分布'
    );
  }
  const groups = new Map();
  const addAmount = (account, amount) => {
    groups.set(account, (groups.get(account) || 0) + amount);
  };
  for (const row of validSales) {
    const amount = centsField(row, 'bill_pay_amt', '销售单');
    if (amount < 0) throw new PosterError('NEGATIVE_COLLECTION', '销售单.bill_pay_amt 不应为负数');
    if (amount === 0) continue;
    const account = safeText(requiredField(row, 'acct_name', '销售单'), '未命名账户');
    addAmount(account, amount);
  }
  for (const row of receipts) {
    const expected = centsField(row, 'total_amt', '收款单');
    const accounts = requireArray(row.receipt_accounts, '收款单.receipt_accounts');
    let actual = 0;
    for (const item of accounts) {
      const amount = centsField(item, 'amt', '收款单账户明细');
      if (amount < 0) throw new PosterError('NEGATIVE_COLLECTION', '收款单账户明细.amt 不应为负数');
      const account = safeText(requiredField(item, 'acct_name', '收款单账户明细'), '未命名账户');
      addAmount(account, amount);
      actual += amount;
    }
    crossCheck('收款单金额与账户明细', actual, expected);
  }
  const total = [...groups.values()].reduce((sum, value) => sum + value, 0);
  return sortDesc([...groups.entries()].map(([name, amount_cents]) => ({
    name,
    amount_cents,
    share: total === 0 ? 0 : amount_cents / total
  })), (row) => row.amount_cents);
}

function crossCheck(label, actual, expected, tolerance = 1) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new PosterError('CROSS_CHECK_FAILED', `${label}交叉校验失败，相差 ${formatMoney(Math.abs(actual - expected), true)}`);
  }
}

function rateText(rate) {
  if (rate === null) return '暂无可比基数';
  return `${rate >= 0 ? '增长' : '回落'} ${Math.abs(rate * 100).toFixed(1)}%`;
}

function insightText({ salesComparison, primaryProduct, salesTotal }) {
  if (salesTotal === 0) return '本月还没有销售记录，先把开单和回款节奏跑起来。';
  const product = primaryProduct?.name || '主力商品';
  if (salesComparison.rate === null) return `本月销售已起量，${product}是当前销售主力。`;
  if (salesComparison.rate >= 0.1) return `本月销售较上月同期增长 ${Math.abs(salesComparison.rate * 100).toFixed(1)}%，${product}表现最突出。`;
  if (salesComparison.rate <= -0.1) return `本月销售较上月同期回落 ${Math.abs(salesComparison.rate * 100).toFixed(1)}%，先稳住${product}等主力商品。`;
  return `本月销售与上月同期基本持平，${product}贡献最稳定。`;
}

function actionItems({ debts, outOfStock, lowStock, salesComparison, primaryProduct }) {
  const actions = [];
  if (debts.rows[0]?.amount_cents > 0) {
    actions.push(`先跟进「${clippedName(debts.rows[0].name)}」等重点欠款客户，加快资金回笼。`);
  }
  if (outOfStock.length) {
    const names = outOfStock.slice(0, 2).map((row) => `「${clippedName(row.name, 9)}」`).join('、');
    actions.push(`优先补齐${names}${outOfStock.length > 2 ? `等 ${outOfStock.length} 款` : ''}缺货商品。`);
  } else if (lowStock.length) {
    const names = lowStock.slice(0, 2).map((row) => `「${clippedName(row.name, 9)}」`).join('、');
    actions.push(`复核${names}${lowStock.length > 2 ? '等低库存商品' : ''}的补货计划。`);
  }
  if (actions.length < 3 && salesComparison.rate !== null && salesComparison.rate < -0.05) {
    actions.push('复盘销售回落日期的商品和客户变化，先找出减少最多的一项。');
  }
  if (actions.length < 3 && primaryProduct) {
    actions.push(`保持「${clippedName(primaryProduct.name)}」的库存周转，同时关注利润表现。`);
  }
  return actions.slice(0, 3);
}

export function buildMonthlyReportModel({
  month,
  asOf,
  shopName,
  fetchedAt,
  current,
  previous,
  snapshots
}) {
  const ranges = collectionRanges(month, asOf);
  const { year, month: monthNumber } = parseMonth(month);
  requireObject(current, '本期数据');
  requireObject(previous, '对比期数据');
  requireObject(snapshots, '当前风险快照');

  const currentSales = requireArray(current.sales, '本期销售单').filter(validSale);
  const previousSales = requireArray(previous.sales, '对比期销售单').filter(validSale);
  const currentBillDaily = billDaily(current.billStats, ranges.current, '本期单据销售统计');
  const previousBillDaily = billDaily(previous.billStats, ranges.previous, '对比期单据销售统计');
  const salesTotal = mapTotal(currentBillDaily);
  const previousSalesTotal = mapTotal(previousBillDaily);
  const currentCollections = aggregateSources({
    sales: currentSales,
    receipts: current.receipts,
    returns: current.returns
  }, ranges.current.start, ranges.current.end);
  const previousCollections = aggregateSources({
    sales: previousSales,
    receipts: previous.receipts,
    returns: previous.returns
  }, ranges.previous.start, ranges.previous.end);
  const receiptsTotal = mapTotal(currentCollections.daily);
  const previousReceiptsTotal = mapTotal(previousCollections.daily);
  const outstanding = currentSales.reduce((sum, row) => {
    const amount = centsField(row, 'owe_amt', '销售单');
    if (amount < 0) throw new PosterError('NEGATIVE_OUTSTANDING', '销售单.owe_amt 不应为负数');
    return sum + amount;
  }, 0);

  const currentProfitReport = requireObject(current.fundProfit, '本期经营利润');
  const previousProfitReport = requireObject(previous.fundProfit, '对比期经营利润');
  const totalIncome = centsField(currentProfitReport, 'sum_in_v2', '本期经营利润');
  const totalExpense = centsField(currentProfitReport, 'sum_out_v2', '本期经营利润');
  const operatingProfit = centsField(currentProfitReport, 'sum_profit_v2', '本期经营利润');
  const previousTotalIncome = centsField(previousProfitReport, 'sum_in_v2', '对比期经营利润');
  const previousTotalExpense = centsField(previousProfitReport, 'sum_out_v2', '对比期经营利润');
  const previousOperatingProfit = centsField(previousProfitReport, 'sum_profit_v2', '对比期经营利润');
  crossCheck('本期经营利润与总收入减总支出', operatingProfit, totalIncome - totalExpense);
  crossCheck('对比期经营利润与总收入减总支出', previousOperatingProfit, previousTotalIncome - previousTotalExpense);
  crossCheck('销售额与经营利润报表.sale_in', salesTotal, centsField(currentProfitReport, 'sale_in', '本期经营利润'));
  crossCheck('对比期销售额与经营利润报表.sale_in', previousSalesTotal, centsField(previousProfitReport, 'sale_in', '对比期经营利润'));

  const channels = channelBreakdown(current, currentSales);
  if (current.returns.length === 0) {
    crossCheck('实收金额与收款渠道合计', receiptsTotal, channels.reduce((sum, row) => sum + row.amount_cents, 0));
  }

  const products = normalizeProducts(current.products, '本期商品销售统计');
  const customers = normalizeCustomers(current.customers, '本期客户销售统计');
  const operators = normalizeOperators(current.operators, '本期员工业绩');
  const purchaseSummary = normalizePurchaseSummary(current.purchase, '本期进货统计');
  const previousPurchaseSummary = normalizePurchaseSummary(previous.purchase, '对比期进货统计');
  const currentPurchaseBills = Array.isArray(current.purchaseBills) ? current.purchaseBills.filter(validSale) : null;
  const previousPurchaseBills = Array.isArray(previous.purchaseBills) ? previous.purchaseBills.filter(validSale) : null;
  if (currentPurchaseBills) {
    crossCheck('本期进货金额与进货单合计', purchaseSummary.total_amount_cents, currentPurchaseBills.reduce((sum, row) => sum + centsField(row, 'total_amt', '本期进货单'), 0));
  }
  if (previousPurchaseBills) {
    crossCheck('对比期进货金额与进货单合计', previousPurchaseSummary.total_amount_cents, previousPurchaseBills.reduce((sum, row) => sum + centsField(row, 'total_amt', '对比期进货单'), 0));
  }
  const purchase = {
    ...purchaseSummary,
    order_count: currentPurchaseBills ? currentPurchaseBills.length : purchaseSummary.order_count
  };
  const previousPurchase = {
    ...previousPurchaseSummary,
    order_count: previousPurchaseBills ? previousPurchaseBills.length : previousPurchaseSummary.order_count
  };
  const debts = normalizeDebts(snapshots.debts);
  const { lowStock, outOfStock } = standardizeInventoryRisks(
    normalizeStock(snapshots.lowStock, '低库存'),
    normalizeStock(snapshots.outOfStock, '缺货')
  );
  const primaryProduct = sortDesc(products, (row) => row.sales_cents)[0] || null;
  const salesComparison = comparison(salesTotal, previousSalesTotal);
  const series = cumulativeSeries({
    month,
    range: ranges.current,
    currentDaily: currentBillDaily,
    previousRange: ranges.previous,
    previousDaily: previousBillDaily
  });
  const highestCandidate = series.reduce((best, point) => !best || point.sales_cents > best.sales_cents ? point : best, null);
  const highest = highestCandidate?.sales_cents > 0 ? highestCandidate : null;
  const totalDebtCents = debts.rows.reduce((sum, row) => sum + row.amount_cents, 0);
  const debtLead = debts.rows[0];
  const riskText = debtLead
    ? `${debts.total} 位客户有欠款，优先跟进「${clippedName(debtLead.name)}」等重点客户。`
    : '当前没有客户欠款，继续保持回款节奏。';
  const receiptRate = salesTotal === 0 ? null : receiptsTotal / salesTotal;
  const profitRate = salesTotal === 0 ? null : operatingProfit / salesTotal;
  const orderComparison = comparison(currentSales.length, previousSales.length);
  const receiptComparison = comparison(receiptsTotal, previousReceiptsTotal);
  const profitComparison = comparison(operatingProfit, previousOperatingProfit);

  return {
    schema_version: 1,
    poster_type: 'monthly_business_report',
    page_count: 3,
    period: {
      month,
      year,
      month_number: monthNumber,
      start: ranges.current.start,
      end: ranges.current.end,
      as_of: asOf,
      comparison_start: ranges.previous.start,
      comparison_end: ranges.previous.end,
      relation: ranges.relation,
      calendar_days: daysInMonth(year, monthNumber)
    },
    shop: { name: safeText(shopName, '我的店铺') },
    currency: 'CNY',
    overview: {
      sales_cents: salesTotal,
      receipts_cents: receiptsTotal,
      receipt_rate: receiptRate,
      total_income_cents: totalIncome,
      total_expense_cents: totalExpense,
      operating_profit_cents: operatingProfit,
      profit_rate: profitRate,
      order_count: currentSales.length,
      outstanding_cents: outstanding
    },
    comparison: {
      sales: salesComparison,
      receipts: receiptComparison,
      profit: profitComparison,
      expenses: comparison(totalExpense, previousTotalExpense),
      orders: orderComparison
    },
    purchase,
    purchase_comparison: {
      amount: comparison(purchase.total_amount_cents, previousPurchase.total_amount_cents),
      quantity: comparison(purchase.total_quantity, previousPurchase.total_quantity),
      orders: comparison(purchase.order_count, previousPurchase.order_count),
      products: comparison(purchase.row_count, previousPurchase.row_count)
    },
    daily: series,
    highest_day: highest ? { date: highest.date, amount_cents: highest.sales_cents } : { date: null, amount_cents: 0 },
    channels,
    products: {
      primary: primaryProduct ? {
        ...primaryProduct,
        sales_share: salesTotal === 0 ? 0 : primaryProduct.sales_cents / salesTotal
      } : null,
      volume_top: sortDesc(products, (row) => row.quantity).slice(0, 5),
      profit_top: sortDesc(products, (row) => row.profit_cents).slice(0, 5)
    },
    customers: {
      sales_top: sortDesc(customers, (row) => row.sales_cents).slice(0, 5),
      debt_top: debts.rows.slice(0, 5),
      debt_total_count: debts.total,
      debt_total_cents: totalDebtCents
    },
    operators: {
      sales_top: sortDesc(operators, (row) => row.sales_cents).slice(0, 5)
    },
    risks: {
      low_stock: lowStock,
      out_of_stock: outOfStock,
      snapshot_as_of: asOf
    },
    insights: {
      headline: insightText({ salesComparison, primaryProduct, salesTotal }),
      primary_product: primaryProduct ? `「${primaryProduct.name}」贡献 ${(primaryProduct.sales_cents / Math.max(salesTotal, 1) * 100).toFixed(1)}% 销售额，建议保持主力商品供应。` : '本月暂无商品销售贡献数据。',
      risk: riskText,
      leading_channel: channels[0] ? `本月实收主要来自「${channels[0].name}」，占 ${(channels[0].share * 100).toFixed(1)}%。` : '本月暂无已验证的实收渠道数据。',
      sales_change: rateText(salesComparison.rate)
    },
    actions: actionItems({ debts, outOfStock, lowStock, salesComparison, primaryProduct }),
    quality: {
      status: 'ok',
      fetched_at: fetchedAt || new Date().toISOString(),
      current_bill_count: current.billStats.length,
      current_sale_count: currentSales.length,
      previous_bill_count: previous.billStats.length,
      previous_sale_count: previousSales.length,
      current_purchase_row_count: purchase.row_count,
      previous_purchase_row_count: previousPurchase.row_count,
      warnings: []
    }
  };
}
