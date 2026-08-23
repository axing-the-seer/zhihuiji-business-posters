import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateSources, buildCalendarModel, amountToCents, collectionRanges, daysInMonth, isIsoDate, shouldCrossCheckCurrentSummary } from '../scripts/calendar-core.mjs';
import { calendarGrid, renderCalendarSvg } from '../scripts/calendar-render.mjs';

test('金额按分精确转换并四舍五入', () => {
  assert.equal(amountToCents('0.1'), 10);
  assert.equal(amountToCents('12.345'), 1235);
  assert.equal(amountToCents(-1.239), -124);
});

test('日期校验拒绝不存在的自然日', () => {
  assert.equal(isIsoDate('2024-02-29'), true);
  assert.equal(isIsoDate('2025-02-29'), false);
  assert.equal(isIsoDate('2026-04-31'), false);
});

test('到账收款合并即时实收和已验证的独立收款', () => {
  const result = aggregateSources({
    sales: [
      { id: 1, bill_date: '2026-08-01', bill_pay_amt: 100, status: 'NORMAL', is_invalid: false },
      { id: 2, bill_date: '2026-08-01', bill_pay_amt: 999, status: 'NORMAL', is_invalid: true }
    ],
    receipts: [{ id: 3, bill_date: '2026-08-02', total_amt: 25, status: 1 }],
    returns: []
  }, '2026-08-01', '2026-08-22');
  assert.equal(result.daily.get('2026-08-01'), 10000);
  assert.equal(result.daily.get('2026-08-02'), 2500);
  assert.equal(result.events.length, 2);
});

test('未知收款状态和未验证退货都会停止生成', () => {
  assert.throws(() => aggregateSources({
    sales: [],
    receipts: [{ id: 1, bill_date: '2026-08-01', total_amt: 10, status: 2 }],
    returns: []
  }, '2026-08-01', '2026-08-22'), (error) => error.code === 'RECEIPT_STATUS_UNVERIFIED');
  assert.throws(() => aggregateSources({
    sales: [],
    receipts: [],
    returns: [{ id: 2, bill_date: '2026-08-02', pay_amt: 10 }]
  }, '2026-08-01', '2026-08-22'), (error) => error.code === 'SALES_RETURN_UNVERIFIED');
});

test('当前月与上月相同进度比较', () => {
  assert.deepEqual(collectionRanges('2026-08', '2026-08-22'), {
    relation: 'current',
    current: { start: '2026-08-01', end: '2026-08-22' },
    previous: { start: '2026-07-01', end: '2026-07-22' }
  });
});

test('闰年二月和跨年上月范围自动适配', () => {
  assert.deepEqual(collectionRanges('2024-02', '2026-08-22'), {
    relation: 'historical',
    current: { start: '2024-02-01', end: '2024-02-29' },
    previous: { start: '2024-01-01', end: '2024-01-31' }
  });
  assert.deepEqual(collectionRanges('2026-01', '2026-08-22').previous, {
    start: '2025-12-01',
    end: '2025-12-31'
  });
});

test('仅在生成今天的当前月且无独立收退款时交叉校验综合报表', () => {
  const ranges = collectionRanges('2026-08', '2026-08-22');
  const currentSources = { receipts: [], returns: [] };
  assert.equal(shouldCrossCheckCurrentSummary({ ranges, asOf: '2026-08-22', today: '2026-08-22', currentSources }), true);
  assert.equal(shouldCrossCheckCurrentSummary({ ranges, asOf: '2026-08-22', today: '2026-08-23', currentSources }), false);
  assert.equal(shouldCrossCheckCurrentSummary({ ranges, asOf: '2026-08-22', today: '2026-08-22', currentSources: { receipts: [{ id: 1 }], returns: [] } }), false);
});

test('模型计算 KPI、未来日和固定提示', () => {
  const model = buildCalendarModel({
    month: '2026-08',
    asOf: '2026-08-22',
    shopName: '我的店铺',
    fetchedAt: '2026-08-22T08:00:00.000Z',
    currentSources: {
      sales: [
        { id: 1, bill_date: '2026-08-01', bill_pay_amt: 100, status: 'NORMAL', is_invalid: false },
        { id: 2, bill_date: '2026-08-03', bill_pay_amt: 50.25, status: 'NORMAL', is_invalid: false }
      ],
      receipts: [{ id: 3, bill_date: '2026-08-02', total_amt: 25, status: 1 }],
      returns: []
    },
    previousSources: {
      sales: [{ id: 5, bill_date: '2026-07-01', bill_pay_amt: 100, status: 'NORMAL', is_invalid: false }],
      receipts: [],
      returns: []
    }
  });
  assert.equal(model.metrics.total_cents, 17525);
  assert.equal(model.metrics.collection_days, 3);
  assert.equal(model.metrics.operating_ratio, 3 / 22);
  assert.equal(model.metrics.average_cents, 5842);
  assert.deepEqual(model.metrics.highest_day, { date: '2026-08-01', amount_cents: 10000 });
  assert.equal(model.comparison.delta_cents, 7525);
  assert.equal(model.days.find((day) => day.day === 23).status, 'future');
  assert.match(model.tip, /连续 19 日无收款记录/);
});

test('今日为最高单日时显示今日收款提示', () => {
  const model = buildCalendarModel({
    month: '2026-08',
    asOf: '2026-08-03',
    shopName: '测试店铺',
    currentSources: {
      sales: [
        { id: 1, bill_date: '2026-08-01', bill_pay_amt: 100, status: 'NORMAL', is_invalid: false },
        { id: 2, bill_date: '2026-08-03', bill_pay_amt: 200, status: 'NORMAL', is_invalid: false }
      ],
      receipts: [],
      returns: []
    },
    previousSources: {
      sales: [{ id: 3, bill_date: '2026-07-01', bill_pay_amt: 100, status: 'NORMAL', is_invalid: false }],
      receipts: [],
      returns: []
    }
  });
  assert.equal(model.tip, '今日收款 ¥200.00，为本月当前最高单日收款。');
});

test('上月同期为零时不制造百分比', () => {
  const model = buildCalendarModel({
    month: '2026-08',
    asOf: '2026-08-02',
    shopName: '测试店铺',
    currentSources: {
      sales: [{ id: 1, bill_date: '2026-08-01', bill_pay_amt: 20, status: 'NORMAL', is_invalid: false }],
      receipts: [],
      returns: []
    },
    previousSources: { sales: [], receipts: [], returns: [] }
  });
  assert.equal(model.comparison.rate, null);
  assert.equal(model.tip, '本月最高单日收款为 ¥20.00，出现在 8月1日。');
});

test('连续五日有收款时显示连续营业提示', () => {
  const model = buildCalendarModel({
    month: '2026-08',
    asOf: '2026-08-06',
    shopName: '测试店铺',
    currentSources: {
      sales: [1, 2, 3, 4, 5, 6].map((day) => ({
        id: day,
        bill_date: `2026-08-0${day}`,
        bill_pay_amt: day === 1 ? 100 : day * 10,
        status: 'NORMAL',
        is_invalid: false
      })),
      receipts: [],
      returns: []
    },
    previousSources: { sales: [], receipts: [], returns: [] }
  });
  assert.equal(model.tip, '最近连续 6 日均有收款记录');
});

function emptyHistoricalModel(month) {
  return buildCalendarModel({
    month,
    asOf: '2026-08-22',
    shopName: '版式测试店铺',
    fetchedAt: '2026-08-22T08:00:00.000Z',
    currentSources: { sales: [], receipts: [], returns: [] },
    previousSources: { sales: [], receipts: [], returns: [] }
  });
}

test('12 个月、28/29/30/31 天与双位月份标题自动适配', () => {
  for (let month = 1; month <= 12; month += 1) {
    const period = `2024-${String(month).padStart(2, '0')}`;
    const model = emptyHistoricalModel(period);
    assert.equal(model.days.length, daysInMonth(2024, month));
    const svg = renderCalendarSvg(model);
    assert.match(svg, new RegExp(`>${month}<tspan dx="10"[^>]*>月 / 2024</tspan>`));
  }
});

test('六行日历的最后一行保持在指标卡上方', () => {
  const grid = calendarGrid(emptyHistoricalModel('2025-03'));
  assert.match(grid, /<rect x="214" y="917" width="120" height="76"/);
});

test('最终页面不含占位符或异常提示词', () => {
  const svg = renderCalendarSvg(emptyHistoricalModel('2024-12'));
  const inspectable = svg.replace(/data:image\/[a-z+.-]+;base64,[^"]+/gi, '');
  const forbidden = [
    /\{(?:店铺名|月份|年份|日期|更新时间)\}/,
    /TODO|FIXME|PLACEHOLDER|Lorem ipsum/i,
    /ignore previous|system prompt|developer message|prompt injection/i,
    /ChatGPT|Claude|Gemini/
  ];
  for (const pattern of forbidden) assert.doesNotMatch(inspectable, pattern);
});
