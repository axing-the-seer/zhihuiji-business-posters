#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let state = 20260823;
const random = () => {
  state = (state * 1664525 + 1013904223) >>> 0;
  return state / 0x100000000;
};
const sale = (id, date, amount) => ({
  id,
  bill_date: date,
  bill_pay_amt: amount,
  status: 'NORMAL',
  is_invalid: false
});
const currentSales = Array.from({ length: 22 }, (_, index) => {
  const day = index + 1;
  const amount = Number((80 + day * 7 + Math.floor(random() * 140)).toFixed(2));
  return sale(day, `2026-08-${String(day).padStart(2, '0')}`, amount);
});
const fixture = {
  fixture_notice: 'SYNTHETIC_FIXED_SEED_20260823',
  shopName: '固定种子合成测试店铺',
  fetchedAt: '2026-08-22T08:30:00.000Z',
  currentSources: { sales: currentSales, receipts: [], returns: [] },
  previousSources: {
    sales: [1, 8, 15, 22].map((day, index) => sale(101 + index, `2026-07-${String(day).padStart(2, '0')}`, 240 + day * 9)),
    receipts: [],
    returns: []
  }
};
const strictReturnFixture = {
  fixture_notice: 'SYNTHETIC_RETURN_FAIL_CLOSED',
  shopName: '合成退货严格失败测试店铺',
  fetchedAt: '2026-08-22T06:00:00.000Z',
  currentSources: {
    sales: [sale(1, '2026-08-01', 120), sale(2, '2026-08-03', 80)],
    receipts: [{ id: 4, bill_date: '2026-08-06', total_amt: 60, status: 1 }],
    returns: [{ id: 5, bill_date: '2026-08-02', pay_amt: 180 }]
  },
  previousSources: { sales: [sale(101, '2026-07-01', 500)], receipts: [], returns: [] }
};

writeFileSync(join(directory, 'calendar-2026-08.json'), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
writeFileSync(join(directory, 'calendar-negative-2026-08.json'), `${JSON.stringify(strictReturnFixture, null, 2)}\n`, 'utf8');
