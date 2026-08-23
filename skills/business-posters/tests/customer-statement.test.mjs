import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStatementAmounts } from '../scripts/customer-statement-core.mjs';

function detail(rows, terminal) {
  return {
    rows,
    summary: {
      should_pay: rows.reduce((sum, row) => sum + row.should_pay_amt, 0),
      real_pay: rows.reduce((sum, row) => sum + row.real_pay_amt, 0),
      terminal
    }
  };
}

test('全额销售加以前欠款回款按账款净变动核对', () => {
  const amounts = validateStatementAmounts({
    begin_tamt: 463.3,
    arrears_tamt: -120,
    terminal_tamt: 343.3
  }, detail([
    { should_pay_amt: 0, real_pay_amt: 120 },
    { should_pay_amt: 206, real_pay_amt: 206 }
  ], 343.3));

  assert.deepEqual(amounts, {
    beginning_cents: 46330,
    should_pay_cents: 20600,
    real_pay_cents: 32600,
    net_change_cents: -12000,
    ending_debt_cents: 34330
  });
});

test('含税部分付款按单据总额而非未税金额核对', () => {
  const amounts = validateStatementAmounts({
    begin_tamt: 0,
    arrears_tamt: 272.67,
    terminal_tamt: 272.67
  }, detail([
    { should_pay_amt: 372.67, real_pay_amt: 100 },
    { should_pay_amt: 251, real_pay_amt: 251 }
  ], 272.67));

  assert.equal(amounts.should_pay_cents, 62367);
  assert.equal(amounts.real_pay_cents, 35100);
  assert.equal(amounts.net_change_cents, 27267);
});

test('汇总与逐笔记录不一致时仍会停止导出', () => {
  assert.throws(() => validateStatementAmounts({
    begin_tamt: 0,
    arrears_tamt: 50,
    terminal_tamt: 50
  }, {
    rows: [{ should_pay_amt: 60, real_pay_amt: 0 }],
    summary: { should_pay: 50, real_pay: 0, terminal: 50 }
  }), (error) => error.code === 'STATEMENT_AMOUNT_MISMATCH');
});
