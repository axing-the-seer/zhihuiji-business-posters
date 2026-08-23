import { PosterError, amountToCents } from './calendar-core.mjs';

function assertSameCents(label, leftCents, rightCents) {
  if (Math.abs(leftCents - rightCents) > 1) {
    throw new PosterError('STATEMENT_AMOUNT_MISMATCH', `${label}不一致`);
  }
}

function sumRows(rows, field, label) {
  let total = 0;
  for (const [index, row] of rows.entries()) {
    total += amountToCents(row?.[field], `${label}.明细[${index}].${field}`);
    if (!Number.isSafeInteger(total)) {
      throw new PosterError('AMOUNT_TOO_LARGE', `${label}合计超出安全范围`);
    }
  }
  return total;
}

export function validateStatementAmounts(customer, detail) {
  if (!customer || !detail || !Array.isArray(detail.rows) || !detail.summary) {
    throw new PosterError('STATEMENT_DETAIL_SHAPE', '客户对账数据结构异常');
  }

  const summaryShouldPay = amountToCents(detail.summary.should_pay, '对账明细.本期单据金额');
  const summaryRealPay = amountToCents(detail.summary.real_pay, '对账明细.本期实收');
  const summaryEnding = amountToCents(detail.summary.terminal, '对账明细.累计欠款');
  const rowsShouldPay = sumRows(detail.rows, 'should_pay_amt', '本期单据金额');
  const rowsRealPay = sumRows(detail.rows, 'real_pay_amt', '本期实收');

  assertSameCents('本期单据金额在明细合计与逐笔记录中', summaryShouldPay, rowsShouldPay);
  assertSameCents('本期实收在明细合计与逐笔记录中', summaryRealPay, rowsRealPay);

  const netChange = summaryShouldPay - summaryRealPay;
  const listNetChange = amountToCents(customer.arrears_tamt, '客户汇总.本期账款变动');
  const listBeginning = amountToCents(customer.begin_tamt, '客户汇总.期初欠款');
  const listEnding = amountToCents(customer.terminal_tamt, '客户汇总.累计欠款');

  assertSameCents('本期账款变动在客户汇总与对账明细中', listNetChange, netChange);
  assertSameCents('累计欠款在客户汇总与对账明细中', listEnding, summaryEnding);
  assertSameCents('期初欠款与本期账款变动推导的累计欠款', listBeginning + netChange, listEnding);

  return {
    beginning_cents: listBeginning,
    should_pay_cents: summaryShouldPay,
    real_pay_cents: summaryRealPay,
    net_change_cents: netChange,
    ending_debt_cents: listEnding
  };
}
