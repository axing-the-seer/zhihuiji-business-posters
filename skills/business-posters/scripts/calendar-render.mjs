import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { formatMoney, PosterError } from './calendar-core.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(SCRIPT_DIR, '..');
const FONT_STACK = 'PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif';

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function imageData(relativePath) {
  const path = resolve(SKILL_DIR, relativePath);
  const extension = extname(path).slice(1).toLowerCase();
  const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

function shortText(value, max) {
  const chars = Array.from(String(value));
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join('')}…`;
}

function formatUpdatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 16);
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function comparisonPresentation(comparison) {
  if (comparison.rate === null) return { color: '#6B7690', arrow: '', rate: '—' };
  const positive = comparison.delta_cents >= 0;
  return {
    color: positive ? '#12A870' : '#F05252',
    arrow: positive ? '↑' : '↓',
    rate: `${Math.abs(comparison.rate * 100).toFixed(1)}%`
  };
}

function metricIcon(kind, cx, cy) {
  const common = 'fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';
  if (kind === 'money') return `<path d="M${cx - 10} ${cy - 12}h20v24h-20z M${cx - 5} ${cy - 5}h10 M${cx - 5} ${cy + 2}h10 M${cx} ${cy - 8}v14" ${common}/>`;
  if (kind === 'calendar') return `<rect x="${cx - 11}" y="${cy - 10}" width="22" height="20" rx="3" ${common}/><path d="M${cx - 6} ${cy - 14}v7 M${cx + 6} ${cy - 14}v7 M${cx - 10} ${cy - 3}h20 M${cx - 5} ${cy + 2}l4 4 7-8" ${common}/>`;
  if (kind === 'average') return `<circle cx="${cx}" cy="${cy}" r="11" ${common}/><path d="M${cx} ${cy}V${cy - 8} M${cx} ${cy}l7 4" ${common}/>`;
  return `<path d="M${cx - 12} ${cy + 9}l8-9 7 5 10-14 M${cx + 7} ${cy - 9}h6v6" ${common}/>`;
}

export function calendarGrid(model) {
  const { year, month_number: month } = model.period;
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const x0 = 82;
  const y0 = 487;
  const cellWidth = 120;
  const cellHeight = 76;
  const gapX = 12;
  const gapY = 10;
  const pieces = [];
  for (const item of model.days) {
    const position = firstWeekday + item.day - 1;
    const row = Math.floor(position / 7);
    const col = position % 7;
    const x = x0 + col * (cellWidth + gapX);
    const y = y0 + row * (cellHeight + gapY);
    let fill = '#EEF5FF';
    let stroke = 'none';
    let dateColor = '#101B35';
    let amountColor = '#1769FF';
    if (item.status === 'zero') {
      fill = '#F6F7FA';
      stroke = '#EBEEF4';
      dateColor = '#667085';
      amountColor = '#A0A8B8';
    }
    if (item.status === 'negative') {
      fill = '#FFF1F3';
      stroke = '#FFD5DA';
      dateColor = '#7A3440';
      amountColor = '#E24B5B';
    }
    if (item.status === 'future') {
      fill = '#FFFFFF';
      stroke = '#E7EAF1';
      dateColor = '#7F8798';
      amountColor = '#7F8798';
    }
    if (item.is_today) {
      fill = 'url(#todayCell)';
      stroke = '#1769FF';
      dateColor = '#FFFFFF';
      amountColor = '#FFFFFF';
    }
    pieces.push(`<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" rx="17" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`);
    pieces.push(`<text x="${x + cellWidth / 2}" y="${y + 29}" text-anchor="middle" class="date" fill="${dateColor}">${item.day}</text>`);
    if (item.status !== 'future') pieces.push(`<text x="${x + cellWidth / 2}" y="${y + 57}" text-anchor="middle" class="amount" fill="${amountColor}">${formatMoney(item.amount_cents)}</text>`);
    if (item.is_today) {
      pieces.push(`<rect x="${x + 76}" y="${y - 10}" width="46" height="24" rx="12" fill="#FFFFFF" stroke="#1769FF" stroke-width="2"/>`);
      pieces.push(`<text x="${x + 99}" y="${y + 7}" text-anchor="middle" class="today" fill="#1769FF">今日</text>`);
    }
  }
  return pieces.join('\n');
}

function trendChart(days) {
  const elapsed = days.filter((day) => day.status !== 'future');
  const values = elapsed.map((day) => day.amount_cents);
  const hasNegative = values.some((value) => value < 0);
  const min = hasNegative ? Math.min(...values, 0) : 0;
  const max = Math.max(...values, 1);
  const range = Math.max(max - min, 1);
  const x = 711;
  const y = 1221;
  const width = 250;
  const height = 65;
  const points = values.map((value, index) => {
    const px = x + (values.length === 1 ? width / 2 : index * width / (values.length - 1));
    const py = y + height - (value - min) / range * height;
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  });
  if (!hasNegative) {
    const pointString = points.join(' ');
    const area = values.length > 1 ? `${x},${y + height} ${pointString} ${x + width},${y + height}` : '';
    return `<polygon points="${area}" fill="url(#chartArea)"/><polyline points="${pointString}" fill="none" stroke="#2D7DFF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  const zeroY = y + height - (0 - min) / range * height;
  const segments = points.slice(1).map((point, index) => {
    const color = values[index] < 0 || values[index + 1] < 0 ? '#E24B5B' : '#2D7DFF';
    return `<line x1="${points[index].split(',')[0]}" y1="${points[index].split(',')[1]}" x2="${point.split(',')[0]}" y2="${point.split(',')[1]}" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`;
  }).join('');
  return `<line x1="${x}" y1="${zeroY.toFixed(1)}" x2="${x + width}" y2="${zeroY.toFixed(1)}" stroke="#CFD8E8" stroke-width="1.5" stroke-dasharray="5 5"/>${segments}`;
}

export function renderCalendarSvg(model) {
  const comparison = comparisonPresentation(model.comparison);
  const month = model.period.month_number;
  const year = model.period.year;
  const highest = model.metrics.highest_day;
  const highestDate = highest.date ? `${Number(highest.date.slice(5, 7))}月${Number(highest.date.slice(8, 10))}日` : '—';
  const avg = model.metrics.average_cents === null ? '—' : formatMoney(model.metrics.average_cents);
  const operatingRatio = `${(model.metrics.operating_ratio * 100).toFixed(1)}%`;
  const logoWorkbuddy = imageData('assets/brand/workbuddy-logo.png');
  const logoZhihuiji = imageData('assets/brand/zhihuiji-logo.png');
  const qr = imageData('assets/brand/zhihuiji-qr.png');
  const hero = imageData('assets/calendar/header-store-calendar.png');
  const shop = shortText(model.shop.name, 14);
  const deltaLabel = model.comparison.delta_cents >= 0 ? '增加' : '减少';
  const totalColor = model.metrics.total_cents < 0 ? '#E24B5B' : '#1769FF';
  const hasNegativeDay = model.days.some((day) => day.status === 'negative');
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const weekdaySvg = weekdays.map((day, index) => `<text x="${142 + index * 132}" y="458" text-anchor="middle" class="weekday">${day}</text>`).join('\n');
  const legendSvg = hasNegativeDay
    ? `<rect x="690" y="355" width="18" height="18" rx="6" fill="#66A5FF"/><text x="717" y="371" font-size="16" fill="#65718A">收款</text><rect x="794" y="355" width="18" height="18" rx="6" fill="#F0F2F6" stroke="#E4E8EF"/><text x="821" y="371" font-size="16" fill="#65718A">无收款</text><rect x="916" y="355" width="18" height="18" rx="6" fill="#FFF1F3" stroke="#FFD5DA"/><text x="943" y="371" font-size="16" fill="#65718A">净退款</text>`
    : `<rect x="769" y="355" width="20" height="20" rx="6" fill="#66A5FF"/><text x="800" y="373" font-size="17" fill="#65718A">有收款</text><rect x="882" y="355" width="20" height="20" rx="6" fill="#F0F2F6" stroke="#E4E8EF"/><text x="912" y="373" font-size="17" fill="#65718A">无收款</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1620" viewBox="0 0 1080 1620">
  <defs>
    <radialGradient id="bgGlow" cx="50%" cy="48%" r="74%"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="64%" stop-color="#F7FAFF"/><stop offset="100%" stop-color="#DCEBFF"/></radialGradient>
    <linearGradient id="edgeBlue" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#DDF0FF" stop-opacity=".7"/><stop offset=".52" stop-color="#FFFFFF" stop-opacity="0"/><stop offset="1" stop-color="#4B92FF" stop-opacity=".34"/></linearGradient>
    <linearGradient id="titleBlue" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0E5CFF"/><stop offset="1" stop-color="#39A4FF"/></linearGradient>
    <linearGradient id="todayCell" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B5BFF"/><stop offset="1" stop-color="#2E8BFF"/></linearGradient>
    <linearGradient id="chartArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2D7DFF" stop-opacity=".26"/><stop offset="1" stop-color="#2D7DFF" stop-opacity="0"/></linearGradient>
    <linearGradient id="footerCard" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F5FAFF" stop-opacity=".96"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".92"/></linearGradient>
    <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="18" stdDeviation="28" flood-color="#326CCB" flood-opacity=".14"/></filter>
    <filter id="softShadow" x="-20%" y="-30%" width="140%" height="170%"><feDropShadow dx="0" dy="8" stdDeviation="14" flood-color="#4C78B8" flood-opacity=".10"/></filter>
    <style>
      text { font-family: ${FONT_STACK}; }
      .weekday { font-size: 21px; font-weight: 600; fill: #7F889E; }
      .date { font-size: 23px; font-weight: 700; }
      .amount { font-size: 17px; font-weight: 650; }
      .today { font-size: 13px; font-weight: 700; }
      .kpi-label { font-size: 18px; font-weight: 500; fill: #4F5C78; }
      .kpi-value { font-size: 27px; font-weight: 750; fill: #11182A; }
      .kpi-note { font-size: 15px; fill: #7D879C; }
    </style>
  </defs>

  <rect width="1080" height="1620" fill="url(#bgGlow)"/>
  <rect width="1080" height="1620" fill="url(#edgeBlue)"/>
  <ellipse cx="525" cy="145" rx="530" ry="250" fill="#FFFFFF" opacity=".34"/>
  <g filter="url(#softShadow)"><rect x="48" y="40" width="356" height="76" rx="22" fill="#FFFFFF" fill-opacity=".92"/></g>
  <image x="68" y="57" width="143" height="49" preserveAspectRatio="xMidYMid meet" href="${logoWorkbuddy}"/>
  <line x1="226" y1="58" x2="226" y2="99" stroke="#D9DFEA" stroke-width="2"/>
  <image x="245" y="56" width="137" height="47" preserveAspectRatio="xMidYMid meet" href="${logoZhihuiji}"/>
  <text x="54" y="164" font-size="24" font-weight="600" fill="#66728D">${esc(shop)}</text>
  <text x="52" y="225" font-size="58" font-weight="800" fill="#0F2350">经营<tspan fill="url(#titleBlue)">日历</tspan></text>
  <text x="54" y="269" font-size="24" fill="#5F6D89">每日到账一目了然，生意趋势尽在掌握</text>
  <image x="630" y="24" width="410" height="232" preserveAspectRatio="xMidYMid meet" href="${hero}"/>

  <g filter="url(#cardShadow)"><rect x="43" y="306" width="994" height="1089" rx="32" fill="#FFFFFF" fill-opacity=".97"/></g>
  <text x="76" y="381" font-size="45" font-weight="800" fill="#102044">${month}<tspan dx="10" font-size="24" font-weight="700" fill="#243250">月 / ${year}</tspan></text>
  ${legendSvg}
  ${weekdaySvg}
  <line x1="75" y1="474" x2="1004" y2="474" stroke="#E7EBF2" stroke-width="2"/>
  ${calendarGrid(model)}

  <rect x="65" y="1014" width="950" height="150" rx="24" fill="#FAFCFF" stroke="#E6ECF6" filter="url(#softShadow)"/>
  <line x1="302" y1="1040" x2="302" y2="1139" stroke="#E3E9F3"/><line x1="540" y1="1040" x2="540" y2="1139" stroke="#E3E9F3"/><line x1="778" y1="1040" x2="778" y2="1139" stroke="#E3E9F3"/>
  <circle cx="104" cy="1060" r="25" fill="#3B88FF"/>${metricIcon('money', 104, 1060)}
  <text x="139" y="1059" class="kpi-label">本月收款</text><text x="139" y="1096" class="kpi-value" style="fill:${totalColor}">${formatMoney(model.metrics.total_cents)}</text><text x="139" y="1128" class="kpi-note">元 · 截至${Number(model.period.end.slice(8, 10))}日</text>
  <circle cx="341" cy="1060" r="25" fill="#32C4A4"/>${metricIcon('calendar', 341, 1060)}
  <text x="376" y="1059" class="kpi-label">收款天数</text><text x="376" y="1096" class="kpi-value">${model.metrics.collection_days}<tspan font-size="17" font-weight="500" fill="#59657D"> 天</tspan></text><text x="376" y="1128" class="kpi-note">营业占比 ${operatingRatio}</text>
  <circle cx="579" cy="1060" r="25" fill="#FFB524"/>${metricIcon('average', 579, 1060)}
  <text x="614" y="1059" class="kpi-label">营业日均收款</text><text x="614" y="1096" class="kpi-value">${avg}<tspan font-size="17" font-weight="500" fill="#59657D"> 元</tspan></text><text x="614" y="1128" class="kpi-note">按有收款日计算</text>
  <circle cx="817" cy="1060" r="25" fill="#7C6DF2"/>${metricIcon('peak', 817, 1060)}
  <text x="852" y="1059" class="kpi-label">最高单日</text><text x="852" y="1096" class="kpi-value">${formatMoney(highest.amount_cents)}</text><text x="852" y="1128" class="kpi-note">${highestDate}</text>

  <rect x="65" y="1183" width="456" height="122" rx="24" fill="#F7FAFF" stroke="#E5ECF8"/>
  <text x="92" y="1219" font-size="19" font-weight="700" fill="#273554">较上月同期</text><text x="92" y="1261" font-size="31" font-weight="800" fill="${comparison.color}">${comparison.arrow} ${comparison.rate}</text><text x="92" y="1288" font-size="16" fill="#6C7891">${deltaLabel} ${formatMoney(Math.abs(model.comparison.delta_cents), true)}</text>
  <rect x="538" y="1183" width="477" height="122" rx="24" fill="#F7FAFF" stroke="#E5ECF8"/>
  <text x="566" y="1219" font-size="19" font-weight="700" fill="#273554">本月收款趋势</text>${trendChart(model.days)}
  <rect x="65" y="1321" width="950" height="50" rx="16" fill="#EDF5FF"/><rect x="82" y="1334" width="24" height="24" rx="8" fill="#2A7CFF"/><path d="M90 1351h8 M94 1343v8" stroke="white" stroke-width="2.5" stroke-linecap="round"/><text x="119" y="1353" font-size="17" font-weight="600" fill="#2D4775">${esc(shortText(model.tip, 48))}</text>

  <text x="50" y="1512" font-size="21" font-weight="600" fill="#60708D">数据截止 ${esc(model.period.end)}</text>
  <text x="50" y="1550" font-size="21" fill="#919AAD">由 WorkBuddy 生成</text>
  <g filter="url(#softShadow)"><rect x="520" y="1450" width="512" height="146" rx="28" fill="url(#footerCard)" stroke="#FFFFFF" stroke-opacity=".72"/></g>
  <rect x="540" y="1467" width="112" height="112" rx="17" fill="#FFFFFF" stroke="#D9E8FA"/>
  <image x="548" y="1475" width="96" height="96" href="${qr}"/>
  <rect x="676" y="1480" width="5" height="30" rx="2.5" fill="#2D7DFF"/>
  <text x="696" y="1506" font-size="25" font-weight="780" fill="#162744">智慧记 AI 进销存</text>
  <text x="696" y="1549" font-size="22" font-weight="600" fill="#60708D">300 万批零商户的共同选择</text>
</svg>`;
}

function verifyPng(path) {
  const buffer = readFileSync(path);
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new PosterError('PNG_INVALID', '渲染结果不是 PNG');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== 1080 || height !== 1620) throw new PosterError('PNG_DIMENSIONS', `PNG 尺寸错误：${width}×${height}`);
}

export async function renderCalendarPng(model, outputPath, { keepSvg = false } = {}) {
  let sharp;
  try {
    ({ default: sharp } = await import('sharp'));
  } catch (error) {
    throw new PosterError('RENDERER_MISSING', '经营海报渲染组件未初始化', { cause_code: error?.code || 'UNKNOWN' });
  }
  const absoluteOutput = resolve(outputPath);
  if (extname(absoluteOutput).toLowerCase() !== '.png') throw new PosterError('OUTPUT_EXTENSION', '输出文件必须以 .png 结尾');
  mkdirSync(dirname(absoluteOutput), { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'ailit-calendar-'));
  const svgPath = join(work, 'calendar.svg');
  const pngPath = join(work, 'calendar.png');
  const svg = renderCalendarSvg(model);
  writeFileSync(svgPath, svg, 'utf8');
  try {
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(pngPath);
  } catch (error) {
    rmSync(work, { recursive: true, force: true });
    throw new PosterError('RENDER_FAILED', `PNG 渲染失败：${error.message}`);
  }
  verifyPng(pngPath);
  renameSync(pngPath, absoluteOutput);
  let savedSvg = null;
  if (keepSvg) {
    savedSvg = absoluteOutput.replace(/\.png$/i, '.svg');
    renameSync(svgPath, savedSvg);
  }
  rmSync(work, { recursive: true, force: true });
  return { png: absoluteOutput, svg: savedSvg };
}
