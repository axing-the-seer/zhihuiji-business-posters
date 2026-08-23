export class PosterError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'PosterError';
    this.code = code;
    this.details = details;
  }
}

const INVALID_STATUSES = new Set(['INVALID', 'VOID', 'CANCELLED', 'CANCELED', 'DELETED']);

export function amountToCents(value, fieldName = 'amount') {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new PosterError('INVALID_AMOUNT', `${fieldName} 不是有效金额`);
  }
  const text = String(value).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) {
    throw new PosterError('INVALID_AMOUNT', `${fieldName} 不是有效金额`);
  }
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ''] = unsigned.split('.');
  const third = Number(fraction[2] || '0');
  let cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  if (third >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) {
    throw new PosterError('AMOUNT_TOO_LARGE', `${fieldName} 超出安全范围`);
  }
  return negative ? -cents : cents;
}

export function formatMoney(cents, withSymbol = false) {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100).toLocaleString('en-US');
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${sign}${withSymbol ? '¥' : ''}${whole}.${fraction}`;
}

export function parseMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new PosterError('INVALID_MONTH', `月份必须为 YYYY-MM：${month}`);
  }
  const [year, monthNumber] = month.split('-').map(Number);
  return { year, month: monthNumber };
}

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function previousMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function todayInTimeZone(timeZone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function recordIsValid(record, kind) {
  if (kind === 'receipt' && record?.status !== 1) {
    throw new PosterError('RECEIPT_STATUS_UNVERIFIED', '收款单出现尚未验证的状态，已停止生成');
  }
  if (record?.is_invalid === true) return false;
  const status = String(record?.status ?? '').toUpperCase();
  if (INVALID_STATUSES.has(status)) return false;
  if (kind === 'sale' && status !== 'NORMAL') return false;
  return true;
}

function pickField(record, candidates, label) {
  for (const field of candidates) {
    if (record[field] !== undefined && record[field] !== null && record[field] !== '') {
      return { field, value: record[field] };
    }
  }
  throw new PosterError('UNSUPPORTED_SOURCE_FIELDS', `${label}缺少已支持字段`, {
    available_fields: Object.keys(record || {}).sort()
  });
}

function sourceEvent(record, kind) {
  const contracts = {
    sale: {
      dates: ['bill_date'],
      amounts: ['bill_pay_amt'],
      label: '销售单'
    },
    receipt: {
      dates: ['bill_date'],
      amounts: ['total_amt'],
      label: '收款单'
    }
  };
  const contract = contracts[kind];
  const date = pickField(record, contract.dates, contract.label);
  if (!isIsoDate(String(date.value))) {
    throw new PosterError('INVALID_SOURCE_DATE', `${contract.label}.${date.field} 不是 YYYY-MM-DD`);
  }
  const amount = pickField(record, contract.amounts, contract.label);
  let cents = amountToCents(amount.value, `${contract.label}.${amount.field}`);
  if (cents < 0) {
    throw new PosterError('NEGATIVE_COLLECTION', `${contract.label}.${amount.field} 不应为负数`);
  }
  return {
    date: String(date.value),
    cents,
    source: kind,
    source_id: record.id == null ? null : String(record.id),
    date_field: date.field,
    amount_field: amount.field
  };
}

export function aggregateSources(sources, start, end) {
  if (!isIsoDate(start) || !isIsoDate(end) || start > end) {
    throw new PosterError('INVALID_RANGE', `日期范围无效：${start} 至 ${end}`);
  }
  const events = [];
  const returns = sources.returns || [];
  if (!Array.isArray(returns)) throw new PosterError('INVALID_SOURCE', 'return 数据不是数组');
  if (returns.length > 0) {
    throw new PosterError(
      'SALES_RETURN_UNVERIFIED',
      '当前存在销售退货，但实际退款字段尚未完成真实数据验证，已停止生成'
    );
  }
  const definitions = [
    ['sale', sources.sales || []],
    ['receipt', sources.receipts || []]
  ];
  for (const [kind, rows] of definitions) {
    if (!Array.isArray(rows)) throw new PosterError('INVALID_SOURCE', `${kind} 数据不是数组`);
    for (const row of rows) {
      if (!recordIsValid(row, kind)) continue;
      const event = sourceEvent(row, kind);
      if (event.date >= start && event.date <= end) events.push(event);
    }
  }
  const daily = new Map();
  for (const event of events) daily.set(event.date, (daily.get(event.date) || 0) + event.cents);
  return { daily, events };
}

function monthRelation(targetMonth, asOf) {
  const asOfMonth = asOf.slice(0, 7);
  if (targetMonth > asOfMonth) return 'future';
  if (targetMonth === asOfMonth) return 'current';
  return 'historical';
}

export function collectionRanges(month, asOf) {
  const { year, month: monthNumber } = parseMonth(month);
  if (!isIsoDate(asOf)) throw new PosterError('INVALID_AS_OF', `as-of 日期无效：${asOf}`);
  const relation = monthRelation(month, asOf);
  if (relation === 'future') throw new PosterError('FUTURE_MONTH', '不能生成未来月份经营日历');
  const endDay = relation === 'current' ? Number(asOf.slice(8, 10)) : daysInMonth(year, monthNumber);
  const end = isoDate(year, monthNumber, Math.min(endDay, daysInMonth(year, monthNumber)));
  const previous = previousMonth(year, monthNumber);
  const previousEndDay = relation === 'current'
    ? Math.min(endDay, daysInMonth(previous.year, previous.month))
    : daysInMonth(previous.year, previous.month);
  return {
    relation,
    current: { start: isoDate(year, monthNumber, 1), end },
    previous: {
      start: isoDate(previous.year, previous.month, 1),
      end: isoDate(previous.year, previous.month, previousEndDay)
    }
  };
}

export function shouldCrossCheckCurrentSummary({ ranges, asOf, today, currentSources }) {
  return ranges.relation === 'current'
    && asOf === today
    && (currentSources.receipts || []).length === 0
    && (currentSources.returns || []).length === 0;
}

function sumMap(map) {
  let total = 0;
  for (const value of map.values()) total += value;
  return total;
}

function consecutiveCount(days, predicate) {
  let count = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (!predicate(days[index])) break;
    count += 1;
  }
  return count;
}

export function selectBusinessTip(model) {
  const { total_cents: total } = model.metrics;
  const elapsedDays = model.days.filter((day) => day.status !== 'future');
  const trailingZero = consecutiveCount(elapsedDays, (day) => day.amount_cents === 0);
  const trailingPositive = consecutiveCount(elapsedDays, (day) => day.amount_cents > 0);
  const highest = model.metrics.highest_day;
  const today = model.days.find((day) => day.is_today);

  if (total === 0) return '本月暂未记录收款。';
  if (trailingZero >= 3) return `最近连续 ${trailingZero} 日无收款记录，本月累计为 ${formatMoney(total, true)}。`;
  if (today && highest.date === today.date && highest.amount_cents > 0) return `今日收款 ${formatMoney(highest.amount_cents, true)}，为本月当前最高单日收款。`;
  if (trailingPositive >= 5) return `最近连续 ${trailingPositive} 日均有收款记录`;
  return highest.date
    ? `本月最高单日收款为 ${formatMoney(highest.amount_cents, true)}，出现在 ${Number(highest.date.slice(5, 7))}月${Number(highest.date.slice(8, 10))}日。`
    : '本月暂未记录收款。';
}

export function buildCalendarModel({ month, asOf, shopName, currentSources, previousSources, fetchedAt }) {
  const { year, month: monthNumber } = parseMonth(month);
  const ranges = collectionRanges(month, asOf);
  const current = aggregateSources(currentSources, ranges.current.start, ranges.current.end);
  const previous = aggregateSources(previousSources, ranges.previous.start, ranges.previous.end);
  const total = sumMap(current.daily);
  const previousTotal = sumMap(previous.daily);
  const count = daysInMonth(year, monthNumber);
  const days = [];
  for (let day = 1; day <= count; day += 1) {
    const date = isoDate(year, monthNumber, day);
    const future = date > ranges.current.end;
    const amount = future ? null : (current.daily.get(date) || 0);
    days.push({
      date,
      day,
      amount_cents: amount,
      status: future ? 'future' : amount > 0 ? 'collected' : amount < 0 ? 'negative' : 'zero',
      is_today: date === asOf
    });
  }
  const elapsed = days.filter((day) => day.status !== 'future');
  const positive = elapsed.filter((day) => day.amount_cents > 0);
  const highest = positive.reduce((best, day) => !best || day.amount_cents > best.amount_cents ? day : best, null);
  const collectionDays = positive.length;
  const delta = total - previousTotal;
  const model = {
    schema_version: 1,
    poster_type: 'collection_calendar',
    period: {
      month,
      year,
      month_number: monthNumber,
      start: ranges.current.start,
      end: ranges.current.end,
      as_of: asOf,
      comparison_start: ranges.previous.start,
      comparison_end: ranges.previous.end,
      relation: ranges.relation
    },
    shop: { name: String(shopName || '我的店铺') },
    currency: 'CNY',
    days,
    metrics: {
      total_cents: total,
      collection_days: collectionDays,
      operating_ratio: elapsed.length ? collectionDays / elapsed.length : 0,
      average_cents: collectionDays ? Math.round(total / collectionDays) : null,
      highest_day: highest ? { date: highest.date, amount_cents: highest.amount_cents } : { date: null, amount_cents: 0 }
    },
    comparison: {
      previous_cents: previousTotal,
      delta_cents: delta,
      rate: previousTotal === 0 ? null : delta / previousTotal
    },
    quality: {
      status: 'ok',
      fetched_at: fetchedAt || new Date().toISOString(),
      current_event_count: current.events.length,
      previous_event_count: previous.events.length,
      warnings: []
    }
  };
  model.tip = selectBusinessTip(model);
  return model;
}
