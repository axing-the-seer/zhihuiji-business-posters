import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync
} from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { formatMoney, PosterError } from './calendar-core.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(SCRIPT_DIR, '..');
const FONT_STACK = 'PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif';
const WIDTH = 1080;
const HEIGHT = 1620;
const COLORS = {
  ink: '#101B35',
  text: '#273554',
  muted: '#6C7891',
  faint: '#97A2B5',
  blue: '#2D7DFF',
  blueDark: '#1769E8',
  blueOpen: '#EAF3FF',
  mint: '#32C4A4',
  amber: '#FFB524',
  violet: '#7C6DF2',
  coral: '#EF6C78',
  line: '#E4EBF6',
  card: '#FFFFFF',
  bg: '#F3F7FF'
};

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
  const chars = Array.from(String(value ?? ''));
  return chars.length <= max ? chars.join('') : `${chars.slice(0, Math.max(1, max - 1)).join('')}…`;
}

function estimatedTextWidth(value, fontSize) {
  return Math.ceil(Array.from(String(value ?? '')).reduce((width, char) => {
    if (/\s/.test(char)) return width + fontSize * .32;
    if (/[\u3400-\u9FFF\uF900-\uFAFF]/u.test(char)) return width + fontSize;
    if (/[0-9]/.test(char)) return width + fontSize * .58;
    if (/[A-Z%@¥]/.test(char)) return width + fontSize * .68;
    return width + fontSize * .5;
  }, 0));
}

function wrapLines(value, maxChars, maxLines = 2) {
  const chars = Array.from(String(value ?? ''));
  const lines = [];
  for (let index = 0; index < chars.length && lines.length < maxLines; index += maxChars) {
    lines.push(chars.slice(index, index + maxChars).join(''));
  }
  if (chars.length > maxChars * maxLines && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, Math.max(1, maxChars - 1))}…`;
  }
  return lines.length ? lines : [''];
}

function compactMoney(cents, withSymbol = true) {
  const yuan = cents / 100;
  const sign = yuan < 0 ? '-' : '';
  const absolute = Math.abs(yuan);
  if (absolute >= 100000000) return `${sign}${withSymbol ? '¥' : ''}${(absolute / 100000000).toFixed(1)}亿`;
  if (absolute >= 10000) return `${sign}${withSymbol ? '¥' : ''}${(absolute / 10000).toFixed(1)}万`;
  return formatMoney(cents, withSymbol);
}

function fullMoney(cents) {
  return formatMoney(cents, true);
}

function pct(value) {
  return value === null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`;
}

function comparisonLabel(block) {
  if (block.rate === null) return { text: '较上月同期 —', color: COLORS.muted, fill: '#F2F5FA', direction: 'flat' };
  const up = block.delta >= 0;
  return {
    text: `较上月同期 ${Math.abs(block.rate * 100).toFixed(1)}%`,
    color: up ? '#118C68' : '#D94F5D',
    fill: up ? '#EAF8F3' : '#FFF0F2',
    direction: up ? 'up' : 'down'
  };
}

function trendBadge(x, y, comparison) {
  const width = Math.max(164, 48 + estimatedTextWidth(comparison.text, 17) + 18);
  const mark = comparison.direction === 'flat'
    ? `<line x1="${x + 18}" y1="${y + 22}" x2="${x + 34}" y2="${y + 22}" stroke="${comparison.color}" stroke-width="3" stroke-linecap="round"/>`
    : comparison.direction === 'up'
      ? `<path d="M ${x + 16} ${y + 27} L ${x + 23} ${y + 20} L ${x + 29} ${y + 25} L ${x + 38} ${y + 15}" fill="none" stroke="${comparison.color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M ${x + 32} ${y + 15} H ${x + 38} V ${y + 21}" fill="none" stroke="${comparison.color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<path d="M ${x + 16} ${y + 17} L ${x + 23} ${y + 24} L ${x + 29} ${y + 19} L ${x + 38} ${y + 29}" fill="none" stroke="${comparison.color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M ${x + 32} ${y + 29} H ${x + 38} V ${y + 23}" fill="none" stroke="${comparison.color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<rect x="${x}" y="${y}" width="${width}" height="44" rx="22" fill="${comparison.fill}"/>
    ${mark}
    <text x="${x + 48}" y="${y + 29}" font-size="17" font-weight="700" fill="${comparison.color}">${esc(comparison.text)}</text>`;
}

function monthLabel(model) {
  return `${model.period.year}年${model.period.month_number}月`;
}

function baseDefs() {
  return `<defs>
    <linearGradient id="pageBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F9FCFF"/><stop offset=".5" stop-color="#F1F7FF"/><stop offset="1" stop-color="#EAF2FF"/></linearGradient>
    <linearGradient id="heroBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#F5F9FF"/></linearGradient>
    <linearGradient id="blueOpen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#E9F3FF"/><stop offset="1" stop-color="#F8FBFF"/></linearGradient>
    <linearGradient id="cardSurface" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".52" stop-color="#FCFDFF"/><stop offset="1" stop-color="#F7FAFF"/></linearGradient>
    <linearGradient id="page2Ribbon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".1"/><stop offset=".52" stop-color="#DCEAFF" stop-opacity=".62"/><stop offset="1" stop-color="#FFFFFF" stop-opacity=".08"/></linearGradient>
    <linearGradient id="debtBar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FF9CAB"/><stop offset="1" stop-color="#EF6C78"/></linearGradient>
    <radialGradient id="heroGlow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#CFE5FF" stop-opacity=".72"/><stop offset=".58" stop-color="#E8F3FF" stop-opacity=".38"/><stop offset="1" stop-color="#F4F8FF" stop-opacity="0"/></radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#7292C3" flood-opacity=".14"/></filter>
    <filter id="smallShadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#7292C3" flood-opacity=".12"/></filter>
    <filter id="softBlur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="34"/></filter>
    <pattern id="microTexture" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.2" fill="#B9CBE4" opacity=".16"/><path d="M 18 28 L 28 18" stroke="#C9D7EA" stroke-width="1" opacity=".12"/></pattern>
  </defs>`;
}

function svgShell(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  ${baseDefs()}
  <rect width="1080" height="1620" fill="url(#pageBg)"/>
  <g font-family="${FONT_STACK}">${body}</g>
</svg>`;
}

function jointLogo(x = 48, y = 34) {
  const workbuddy = imageData('assets/brand/workbuddy-logo.png');
  const zhihuiji = imageData('assets/brand/zhihuiji-logo.png');
  return `<g filter="url(#smallShadow)">
    <rect x="${x}" y="${y}" width="348" height="78" rx="24" fill="#FFFFFF" stroke="#E5EDF8"/>
    <image x="${x + 18}" y="${y + 16}" width="150" height="46" href="${workbuddy}" preserveAspectRatio="xMidYMid meet"/>
    <rect x="${x + 181}" y="${y + 17}" width="2" height="44" rx="1" fill="#D8E2F0"/>
    <image x="${x + 198}" y="${y + 17}" width="128" height="44" href="${zhihuiji}" preserveAspectRatio="xMidYMid meet"/>
  </g>`;
}

function page2Backdrop() {
  return `<ellipse cx="260" cy="570" rx="300" ry="430" fill="#FFFFFF" opacity=".24" filter="url(#softBlur)"/>
    <ellipse cx="850" cy="1050" rx="350" ry="420" fill="#DCEAFF" opacity=".22" filter="url(#softBlur)"/>
    <ellipse cx="1038" cy="190" rx="230" ry="420" fill="#D7E7FF" opacity=".18" filter="url(#softBlur)"/>
    <path d="M 930 -80 C 1040 190 986 430 1085 690" fill="none" stroke="#DCE9FB" stroke-width="96" stroke-linecap="round" opacity=".12" filter="url(#softBlur)"/>
    <path d="M 1018 -40 C 1064 180 1032 344 1102 520" fill="none" stroke="#FFFFFF" stroke-width="54" stroke-linecap="round" opacity=".22" filter="url(#softBlur)"/>`;
}

function texturedCard(x, y, width, height, radius, id, glow = '#DCEAFF') {
  return `<defs><clipPath id="${id}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}"/></clipPath></defs>
    <g filter="url(#shadow)"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="#FFFFFF" stroke="#DFE8F5"/></g>
    <g clip-path="url(#${id})">
      <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="url(#cardSurface)"/>
      <ellipse cx="${x + width * .18}" cy="${y + height * .86}" rx="${width * .25}" ry="${height * .52}" fill="${glow}" opacity=".16" filter="url(#softBlur)"/>
      <ellipse cx="${x + width * .86}" cy="${y + height * .06}" rx="${width * .23}" ry="${height * .42}" fill="#FFFFFF" opacity=".72" filter="url(#softBlur)"/>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="url(#microTexture)" opacity=".34"/>
    </g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="none" stroke="#DFE8F5"/>`;
}

function purchaseComparison(x, y, block) {
  if (!block || block.rate === null || !Number.isFinite(block.rate)) {
    return `<text x="${x}" y="${y}" font-size="20" fill="${COLORS.faint}">较上期 —</text>`;
  }
  if (block.delta === 0) {
    return `<text x="${x}" y="${y}" font-size="20" fill="${COLORS.faint}">较上期</text>
      <line x1="${x + 84}" y1="${y - 6}" x2="${x + 100}" y2="${y - 6}" stroke="${COLORS.faint}" stroke-width="3" stroke-linecap="round"/>
      <text x="${x + 110}" y="${y}" font-size="20" font-weight="700" fill="${COLORS.muted}">0.0%</text>`;
  }
  const down = block.delta < 0;
  const color = down ? '#12A878' : '#E36A58';
  const arrow = down
    ? `<path d="M ${x + 92} ${y - 14} V ${y + 1} M ${x + 84} ${y - 6} L ${x + 92} ${y + 2} L ${x + 100} ${y - 6}" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="M ${x + 92} ${y + 2} V ${y - 13} M ${x + 84} ${y - 5} L ${x + 92} ${y - 13} L ${x + 100} ${y - 5}" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<text x="${x}" y="${y}" font-size="20" fill="${COLORS.faint}">较上期</text>${arrow}
    <text x="${x + 110}" y="${y}" font-size="20" font-weight="700" fill="${color}">${Math.abs(block.rate * 100).toFixed(1)}%</text>`;
}

function sectionIcon(kind, cx, cy, color, fill) {
  if (kind === 'warning') {
    return `<circle cx="${cx}" cy="${cy}" r="22" fill="${fill}"/>
      <path d="M ${cx} ${cy - 13} L ${cx + 14} ${cy + 12} H ${cx - 14} Z" fill="${color}"/>
      <rect x="${cx - 1.7}" y="${cy - 6}" width="3.4" height="10" rx="1.7" fill="#FFFFFF"/>
      <circle cx="${cx}" cy="${cy + 8}" r="2" fill="#FFFFFF"/>`;
  }
  if (kind === 'box') {
    return `<circle cx="${cx}" cy="${cy}" r="22" fill="${fill}"/>
      <path d="M ${cx - 11} ${cy - 7} L ${cx} ${cy - 13} L ${cx + 11} ${cy - 7} L ${cx} ${cy - 1} Z M ${cx - 11} ${cy - 5} L ${cx} ${cy + 1} V ${cy + 13} L ${cx - 11} ${cy + 7} Z M ${cx + 11} ${cy - 5} L ${cx} ${cy + 1} V ${cy + 13} L ${cx + 11} ${cy + 7} Z" fill="${color}"/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="22" fill="${fill}"/>
    <path d="M ${cx - 12} ${cy - 7} L ${cx - 5} ${cy + 1} L ${cx} ${cy - 10} L ${cx + 5} ${cy + 1} L ${cx + 12} ${cy - 7} L ${cx + 9} ${cy + 9} H ${cx - 9} Z" fill="${color}"/>
    <circle cx="${cx - 12}" cy="${cy - 8}" r="2.5" fill="${color}"/><circle cx="${cx}" cy="${cy - 11}" r="2.5" fill="${color}"/><circle cx="${cx + 12}" cy="${cy - 8}" r="2.5" fill="${color}"/>`;
}

function reportHeader(model, sectionTitle, pageNumber, artPath, tagline = '') {
  const art = imageData(artPath);
  if (!tagline) {
    return `${jointLogo()}
      <text x="48" y="184" font-size="50" font-weight="850" fill="${COLORS.ink}">${esc(sectionTitle)}</text>
      <rect x="48" y="204" width="128" height="38" rx="19" fill="#E6F1FF"/>
      <text x="112" y="230" text-anchor="middle" font-size="19" font-weight="760" fill="${COLORS.blueDark}">${esc(monthLabel(model))}</text>
      <text x="194" y="230" font-size="21" font-weight="600" fill="${COLORS.muted}">${esc(shortText(model.shop.name, 16))}</text>
      <ellipse cx="808" cy="145" rx="268" ry="152" fill="url(#heroGlow)"/>
      <image x="520" y="0" width="550" height="298" href="${art}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  return `${jointLogo()}
    <text x="50" y="154" font-size="26" font-weight="700" fill="${COLORS.muted}">${esc(shortText(model.shop.name, 16))}</text>
    <text x="48" y="218" font-size="58" font-weight="850" fill="${COLORS.ink}">经营<tspan fill="${COLORS.blue}">月报</tspan></text>
    <text x="50" y="266" font-size="26" font-weight="400" fill="#5F6D89">${esc(tagline)}</text>
    <ellipse cx="808" cy="145" rx="268" ry="152" fill="url(#heroGlow)"/>
    <image x="555" y="0" width="500" height="245" href="${art}" preserveAspectRatio="xMidYMid meet"/>
    <rect x="854" y="246" width="178" height="44" rx="22" fill="#E6F1FF"/>
    <text x="943" y="276" text-anchor="middle" font-size="23" font-weight="760" fill="${COLORS.blueDark}">${esc(monthLabel(model))}</text>`;
}

function pageFooter(model, pageNumber, { large = false, showPageNumber = true, tightSpacing = false } = {}) {
  const qr = imageData('assets/brand/zhihuiji-qr.png');
  const cutoff = tightSpacing ? `数据截止${model.period.end}` : `数据截止 ${model.period.end}`;
  const generatedBy = tightSpacing ? '由WorkBuddy生成' : '由 WorkBuddy 生成';
  const brandName = tightSpacing ? '智慧记AI进销存' : '智慧记 AI 进销存';
  const brandLine = tightSpacing ? '300万批零商户的共同选择' : '300 万批零商户的共同选择';
  if (large) {
    return `<text x="50" y="1512" font-size="21" font-weight="600" fill="${COLORS.muted}">${esc(cutoff)}</text>
      <text x="50" y="1550" font-size="21" fill="${COLORS.faint}">${esc(generatedBy)}</text>
      <g filter="url(#smallShadow)"><rect x="520" y="1450" width="512" height="146" rx="28" fill="#F7FAFF" stroke="#DCE8F7"/></g>
      <rect x="540" y="1467" width="112" height="112" rx="17" fill="#FFFFFF" stroke="#D7E5F6"/>
      <image x="548" y="1475" width="96" height="96" href="${qr}"/>
      <rect x="676" y="1480" width="5" height="30" rx="2.5" fill="${COLORS.blue}"/>
      <text x="696" y="1506" font-size="25" font-weight="780" fill="${COLORS.ink}">${esc(brandName)}</text>
      <text x="696" y="1549" font-size="22" font-weight="600" fill="${COLORS.muted}">${esc(brandLine)}</text>`;
  }
  return `<g filter="url(#smallShadow)"><rect x="48" y="1504" width="984" height="92" rx="24" fill="#F7FAFF" stroke="#DCE8F7"/></g>
    <rect x="942" y="1514" width="72" height="72" rx="13" fill="#FFFFFF" stroke="#D7E5F6"/>
    <image x="947" y="1519" width="62" height="62" href="${qr}"/>
    <rect x="72" y="1522" width="4" height="23" rx="2" fill="${COLORS.blue}"/>
    <text x="90" y="1543" font-size="21" font-weight="760" fill="${COLORS.ink}">智慧记 AI 进销存</text>
    <text x="90" y="1573" font-size="16" fill="${COLORS.muted}">300 万批零商户的共同选择</text>
    <text x="906" y="1542" text-anchor="end" font-size="16" fill="${COLORS.faint}">数据截至 ${esc(model.period.end)}</text>
    ${showPageNumber ? `<text x="906" y="1572" text-anchor="end" font-size="16" fill="${COLORS.faint}">经营月报 ${pageNumber}/3</text>` : ''}`;
}

function secondaryMetricCard({ x, y, width, title, value, note, color }) {
  return `<g filter="url(#smallShadow)"><rect x="${x}" y="${y}" width="${width}" height="128" rx="26" fill="#FFFFFF" stroke="#E4ECF7"/></g>
    <rect x="${x + 24}" y="${y + 24}" width="5" height="30" rx="2.5" fill="${color}"/>
    <text x="${x + 45}" y="${y + 48}" font-size="24" font-weight="700" fill="${COLORS.text}">${esc(title)}</text>
    <text x="${x + 24}" y="${y + 98}" font-size="38" font-weight="850" fill="${COLORS.ink}">${esc(value)}</text>
    <text x="${x + width - 24}" y="${y + 96}" text-anchor="end" font-size="21" fill="${COLORS.muted}">${esc(note)}</text>`;
}

function profitSummaryCard(model, y) {
  return `<g filter="url(#shadow)"><rect x="42" y="${y}" width="996" height="172" rx="32" fill="#FFFFFF" stroke="#DFE8F5"/></g>
    <rect x="72" y="${y + 30}" width="6" height="34" rx="3" fill="${COLORS.amber}"/>
    <text x="94" y="${y + 58}" font-size="28" font-weight="800" fill="${COLORS.ink}">经营利润</text>
    <text x="72" y="${y + 126}" font-size="48" font-weight="850" fill="#C67A0A">${esc(compactMoney(model.overview.operating_profit_cents))}</text>
    <text x="350" y="${y + 58}" font-size="23" fill="${COLORS.muted}">总收入</text>
    <text x="350" y="${y + 112}" font-size="36" font-weight="800" fill="${COLORS.ink}">${esc(compactMoney(model.overview.total_income_cents))}</text>
    <line x1="642" y1="${y + 32}" x2="642" y2="${y + 138}" stroke="#E5ECF6"/>
    <text x="684" y="${y + 58}" font-size="23" fill="${COLORS.muted}">总支出</text>
    <text x="684" y="${y + 112}" font-size="36" font-weight="800" fill="${COLORS.ink}">${esc(compactMoney(model.overview.total_expense_cents))}</text>
    <rect x="889" y="${y + 28}" width="118" height="40" rx="20" fill="#FFF5E6"/>
    <text x="948" y="${y + 55}" text-anchor="middle" font-size="20" font-weight="700" fill="#A66A18">利润率 ${pct(model.overview.profit_rate)}</text>`;
}

function niceScaleMax(maxCents) {
  const maxYuan = Math.max(1, maxCents / 100);
  const roughStep = maxYuan / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return Math.ceil(maxYuan / (nice * magnitude)) * nice * magnitude * 100;
}

function lineChart(model, x, y, width, height) {
  const points = model.daily;
  if (!points.length) return `<text x="${x + width / 2}" y="${y + height / 2}" text-anchor="middle" font-size="22" fill="${COLORS.faint}">暂无趋势数据</text>`;
  const max = niceScaleMax(Math.max(...points.map((point) => Math.max(point.cumulative_cents, point.previous_cumulative_cents)), 1));
  const sx = (index) => x + (points.length === 1 ? width / 2 : index * width / (points.length - 1));
  const sy = (value) => y + height - (value / max) * height;
  let out = '';
  for (let index = 0; index <= 4; index += 1) {
    const gy = y + index * height / 4;
    const value = Math.round(max * (1 - index / 4));
    out += `<line x1="${x}" y1="${gy}" x2="${x + width}" y2="${gy}" stroke="#E5ECF6" stroke-width="1"/>`;
    out += `<text x="${x - 14}" y="${gy + 7}" text-anchor="end" font-size="18" fill="${COLORS.faint}">${(value / 100).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</text>`;
  }
  const currentPoints = points.map((point, index) => `${sx(index).toFixed(1)},${sy(point.cumulative_cents).toFixed(1)}`).join(' ');
  const previousPoints = points.map((point, index) => `${sx(index).toFixed(1)},${sy(point.previous_cumulative_cents).toFixed(1)}`).join(' ');
  out += `<polyline points="${previousPoints}" fill="none" stroke="#B8C3D5" stroke-width="4" stroke-dasharray="9 8" stroke-linecap="round" stroke-linejoin="round"/>`;
  out += `<polyline points="${currentPoints}" fill="none" stroke="${COLORS.blue}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  const wantedDays = [1, 8, 15, 22, model.period.calendar_days];
  const labelIndexes = [...new Set(wantedDays.map((day) => points.findIndex((point) => point.day === day)).filter((index) => index >= 0))];
  for (const index of labelIndexes) {
    out += `<text x="${sx(index)}" y="${y + height + 32}" text-anchor="middle" font-size="19" fill="${COLORS.faint}">${points[index].day}日</text>`;
  }
  const last = points.length - 1;
  out += `<circle cx="${sx(last)}" cy="${sy(points[last].cumulative_cents)}" r="7" fill="#FFFFFF" stroke="${COLORS.blue}" stroke-width="4"/>`;
  return out;
}

function renderOverview(model) {
  const salesComparison = comparisonLabel(model.comparison.sales);
  const orderComparison = comparisonLabel(model.comparison.orders);
  const expenseComparison = comparisonLabel(model.comparison.expenses || { rate: null, delta: 0 });
  const primary = model.products.primary;
  const salesValue = fullMoney(model.overview.sales_cents);
  const profitRateText = `毛利率 ${pct(model.overview.profit_rate)}`;
  const profitRateWidth = estimatedTextWidth(profitRateText, 18) + 36;
  let body = reportHeader(model, '经营月报', 1, 'assets/monthly-report/header-overview-glass-cutout-v3.png', '看清增长，也看清下一步');

  body += `<g filter="url(#shadow)"><rect x="42" y="310" width="996" height="230" rx="34" fill="url(#heroBg)" stroke="#DEE8F6"/></g>
    <text x="72" y="366" font-size="23" font-weight="700" fill="${COLORS.muted}">本月销售额</text>
    <text x="72" y="429" font-size="44" font-weight="850" fill="${COLORS.blueDark}">${esc(salesValue)}</text>
    ${trendBadge(72, 466, salesComparison)}
    <line x1="384" y1="344" x2="384" y2="538" stroke="#E3EBF6"/>
    <text x="414" y="366" font-size="23" font-weight="700" fill="${COLORS.muted}">本月利润</text>
    <text x="414" y="429" font-size="44" font-weight="850" fill="#C67A0A">${esc(fullMoney(model.overview.operating_profit_cents))}</text>
    <rect x="414" y="466" width="${profitRateWidth}" height="44" rx="22" fill="#FFF5E6"/>
    <text x="${414 + profitRateWidth / 2}" y="495" text-anchor="middle" font-size="18" font-weight="700" fill="#A66A18">${esc(profitRateText)}</text>
    <line x1="696" y1="344" x2="696" y2="538" stroke="#E3EBF6"/>
    <text x="726" y="366" font-size="23" font-weight="700" fill="${COLORS.muted}">总支出</text>
    <text x="726" y="429" font-size="44" font-weight="850" fill="${COLORS.ink}">${esc(fullMoney(model.overview.total_expense_cents))}</text>
    ${trendBadge(726, 466, expenseComparison)}`;

  body += `<g filter="url(#smallShadow)"><rect x="42" y="564" width="996" height="188" rx="30" fill="#FFFFFF" stroke="#DFE8F5"/></g>
    <text x="72" y="612" font-size="30" font-weight="820" fill="${COLORS.ink}">经营建议</text>
    <rect x="72" y="630" width="934" height="42" rx="21" fill="#EDF5FF"/>
    <circle cx="94" cy="651" r="8" fill="${COLORS.blue}"/>
    <text x="116" y="659" font-size="23" font-weight="560" fill="${COLORS.text}">${esc(shortText(model.insights.primary_product, 38))}</text>
    <rect x="72" y="686" width="934" height="42" rx="21" fill="#FFF4E5"/>
    <circle cx="94" cy="707" r="8" fill="${COLORS.amber}"/>
    <text x="116" y="715" font-size="23" font-weight="560" fill="${COLORS.text}">${esc(shortText(model.insights.risk, 38))}</text>`;

  body += secondaryMetricCard({ x: 42, y: 776, width: 487, title: '实收金额', value: fullMoney(model.overview.receipts_cents), note: `回款率 ${pct(model.overview.receipt_rate)}`, color: COLORS.mint });
  body += secondaryMetricCard({ x: 551, y: 776, width: 487, title: '销售单数', value: `${model.overview.order_count.toLocaleString('zh-CN')} 单`, note: orderComparison.text, color: COLORS.violet });

  body += `<g filter="url(#shadow)"><rect x="42" y="928" width="996" height="500" rx="34" fill="#FFFFFF" stroke="#DFE8F5"/></g>
    <text x="76" y="980" font-size="30" font-weight="800" fill="${COLORS.ink}">销售趋势</text>
    <circle cx="760" cy="975" r="7" fill="${COLORS.blue}"/><text x="778" y="983" font-size="21" fill="${COLORS.text}">本月</text>
    <line x1="866" y1="975" x2="902" y2="975" stroke="#B8C3D5" stroke-width="4" stroke-dasharray="8 7"/><text x="916" y="983" font-size="21" fill="${COLORS.text}">上月同期</text>
    ${lineChart(model, 160, 1028, 790, 232)}
    <rect x="76" y="1320" width="930" height="88" rx="22" fill="url(#blueOpen)"/>
    <text x="101" y="1351" font-size="21" fill="${COLORS.muted}">本月最高单日收入</text>
    <text x="101" y="1388" font-size="27" font-weight="800" fill="${COLORS.blueDark}">${model.highest_day.date ? `${model.period.month_number}月${Number(model.highest_day.date.slice(8, 10))}日 · ${fullMoney(model.highest_day.amount_cents)}` : '本月销售额为 0'}</text>
    <text x="978" y="1382" text-anchor="end" font-size="24" font-weight="700" fill="${COLORS.muted}">${primary ? `主力商品：${esc(shortText(primary.name, 14))}` : '本月无商品销售记录'}</text>
    ${pageFooter(model, 1, { large: true, showPageNumber: false, tightSpacing: true })}`;
  return svgShell(body);
}

function channelColor(channel, index) {
  if (channel.name.includes('微信')) return COLORS.mint;
  if (channel.name.includes('现金')) return COLORS.amber;
  if (channel.name.includes('支付宝')) return COLORS.blue;
  return [COLORS.violet, COLORS.coral, COLORS.mint, COLORS.amber, COLORS.blue][index % 5];
}

function donut(model, cx, cy, radius) {
  const channels = model.channels;
  const strokeWidth = 34;
  if (!channels.length) {
    return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#E5ECF6" stroke-width="${strokeWidth}"/>
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="23" fill="${COLORS.faint}">暂无渠道</text>
      <text x="${cx}" y="${cy + 31}" text-anchor="middle" font-size="20" fill="${COLORS.faint}">实收记录为 0</text>`;
  }
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const arcs = channels.slice(0, 5).map((channel, index) => {
    const length = channel.share * circumference;
    const element = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${channelColor(channel, index)}" stroke-width="${strokeWidth}" stroke-dasharray="${Math.max(0, length - 4)} ${circumference}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += length;
    return element;
  }).join('');
  return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#EDF2F8" stroke-width="${strokeWidth}"/>${arcs}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="32" font-weight="820" fill="${COLORS.ink}">${esc(fullMoney(model.overview.receipts_cents))}</text>
    <text x="${cx}" y="${cy + 38}" text-anchor="middle" font-size="19" font-weight="560" fill="${COLORS.muted}">本月实际收款</text>`;
}

function channelLegend(model, x, y, { rowGap = 42, amountOffset = 256, shareOffset = 340 } = {}) {
  return model.channels.slice(0, 5).map((channel, index) => {
    const yy = y + index * rowGap;
    return `<circle cx="${x}" cy="${yy}" r="8" fill="${channelColor(channel, index)}"/>
      <text x="${x + 22}" y="${yy + 8}" font-size="23" font-weight="650" fill="${COLORS.text}">${esc(shortText(channel.name, 8))}</text>
      <text x="${x + amountOffset}" y="${yy + 8}" text-anchor="end" font-size="22" fill="${COLORS.ink}">${esc(compactMoney(channel.amount_cents))}</text>
      <text x="${x + shareOffset}" y="${yy + 8}" text-anchor="end" font-size="21" fill="${COLORS.muted}">${(channel.share * 100).toFixed(1)}%</text>`;
  }).join('');
}

function listRows({ items, x, y, width, rowHeight, maxValue, value, secondary, emptyText = '暂无数据', color = COLORS.blue }) {
  if (!items.length) return `<text x="${x + width / 2}" y="${y + 74}" text-anchor="middle" font-size="28" fill="${COLORS.faint}">${esc(emptyText)}</text>`;
  return items.map((item, index) => {
    const yy = y + index * rowHeight;
    const numeric = Math.max(0, value(item));
    const trackX = x + 310;
    const trackWidth = width - 470;
    const barWidth = maxValue <= 0 ? 0 : trackWidth * numeric / maxValue;
    return `<circle cx="${x + 18}" cy="${yy + 15}" r="16" fill="${index === 0 ? color : '#E9EFF8'}"/>
      <text x="${x + 18}" y="${yy + 22}" text-anchor="middle" font-size="16" font-weight="800" fill="${index === 0 ? '#FFFFFF' : COLORS.muted}">${index + 1}</text>
      <text x="${x + 48}" y="${yy + 23}" font-size="23" font-weight="650" fill="${COLORS.text}">${esc(shortText(item.name, 15))}</text>
      <rect x="${trackX}" y="${yy + 10}" width="${trackWidth}" height="9" rx="4.5" fill="#EAF0F8"/>
      <rect x="${trackX}" y="${yy + 10}" width="${barWidth}" height="9" rx="4.5" fill="${index === 0 ? color : color === COLORS.mint ? '#BFECE2' : '#A9C9FF'}"/>
      <text x="${x + width}" y="${yy + 23}" text-anchor="end" font-size="24" font-weight="750" fill="${COLORS.ink}">${esc(secondary(item))}</text>
      `;
  }).join('');
}

function stockRiskRows(items, x, y, width, color, emptyText) {
  if (!items.length) {
    return `<text x="${x + width / 2}" y="${y + 55}" text-anchor="middle" font-size="24" fill="${COLORS.faint}">${esc(emptyText)}</text>`;
  }
  return items.slice(0, 3).map((item, index) => {
    const yy = y + index * 42;
    const stock = `${item.stock.toLocaleString('zh-CN')}${item.unit || ''}`;
    return `<circle cx="${x + 12}" cy="${yy + 12}" r="10" fill="${index === 0 ? color : '#DCE5F2'}"/>
      <text x="${x + 34}" y="${yy + 20}" font-size="24" font-weight="620" fill="${COLORS.text}">${esc(shortText(item.name, 24))}</text>
      <text x="${x + width}" y="${yy + 20}" text-anchor="end" font-size="24" font-weight="760" fill="${color}">${esc(stock)}</text>`;
  }).join('');
}

function compactStockRows(items, x, y, width, color, emptyText) {
  if (!items.length) {
    return `<text x="${x + width / 2}" y="${y + 52}" text-anchor="middle" font-size="21" fill="${COLORS.faint}">${esc(emptyText)}</text>`;
  }
  return items.slice(0, 3).map((item, index) => {
    const yy = y + index * 44;
    const stock = `${item.stock.toLocaleString('zh-CN')}${item.unit || ''}`;
    return `<circle cx="${x + 8}" cy="${yy + 10}" r="8" fill="${index === 0 ? color : '#DCE5F2'}"/>
      <text x="${x + 30}" y="${yy + 18}" font-size="21" font-weight="600" fill="${COLORS.text}">${esc(shortText(item.name, 16))}</text>
      <text x="${x + width}" y="${yy + 18}" text-anchor="end" font-size="21" font-weight="730" fill="${color}">${esc(stock)}</text>`;
  }).join('');
}

function stockRiskPanel({ x, y, width, height, title, rows, color, pale, kind, drawCard = true }) {
  return `${drawCard ? `<g filter="url(#shadow)"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="32" fill="#FFFFFF" stroke="#DFE8F5"/></g>` : ''}
    ${sectionIcon(kind, x + 46, y + 50, color, pale)}
    <text x="${x + 78}" y="${y + 59}" font-size="27" font-weight="800" fill="${COLORS.ink}">${esc(title)}</text>
    <text x="${x + width - 34}" y="${y + 59}" text-anchor="end" font-size="22" font-weight="700" fill="${color}">${rows.length} 种</text>
    ${compactStockRows(rows, x + 38, y + 91, width - 72, color, `当前没有${title}`)}`;
}

function debtLineRows(items, x, y, width, maxValue, rowGap = 43) {
  if (!items.length) return `<text x="${x + width / 2}" y="${y + 76}" text-anchor="middle" font-size="25" fill="${COLORS.faint}">当前没有客户欠款</text>`;
  return items.slice(0, 5).map((item, index) => {
    const yy = y + index * rowGap;
    const trackX = x + 310;
    const trackWidth = width - 470;
    const barWidth = maxValue <= 0 ? 0 : trackWidth * Math.max(0, item.amount_cents) / maxValue;
    return `<circle cx="${x + 18}" cy="${yy + 15}" r="16" fill="${index === 0 ? COLORS.coral : '#E9EFF8'}"/>
      <text x="${x + 18}" y="${yy + 22}" text-anchor="middle" font-size="16" font-weight="800" fill="${index === 0 ? '#FFFFFF' : COLORS.muted}">${index + 1}</text>
      <text x="${x + 48}" y="${yy + 23}" font-size="23" font-weight="650" fill="${COLORS.text}">${esc(shortText(item.name, 15))}</text>
      <rect x="${trackX}" y="${yy + 10}" width="${trackWidth}" height="9" rx="4.5" fill="#EAF0F8"/>
      <rect x="${trackX}" y="${yy + 10}" width="${barWidth}" height="9" rx="4.5" fill="${index === 0 ? COLORS.coral : '#F7B6BE'}"/>
      <text x="${x + width}" y="${yy + 23}" text-anchor="end" font-size="22" font-weight="750" fill="${COLORS.ink}">${esc(fullMoney(item.amount_cents))}</text>`;
  }).join('');
}

function treemapText(item, x, y, width, height, large = false) {
  const compact = height < 60;
  const maxChars = Math.max(4, Math.floor(width / (large ? 24 : 21)));
  const lines = wrapLines(item.name, maxChars, compact ? 1 : height >= 95 ? 2 : 1);
  const nameSize = compact ? 14 : large ? 22 : Math.max(15, Math.min(19, width / 9));
  const startY = compact ? y + 19 : y + height / 2 - (lines.length - 1) * 13 - 5;
  const lineGap = compact ? 20 : 25;
  const nameSvg = lines.map((line, index) => `<text x="${x + width / 2}" y="${startY + index * lineGap}" text-anchor="middle" font-size="${nameSize}" font-weight="650" fill="${COLORS.text}">${esc(line)}</text>`).join('');
  const valueY = compact ? y + 41 : Math.min(y + height - 14, startY + lines.length * lineGap + 8);
  return `${nameSvg}<text x="${x + width / 2}" y="${valueY}" text-anchor="middle" font-size="${compact ? 14 : large ? 20 : 16}" font-weight="760" fill="${COLORS.blueDark}">${esc(fullMoney(item.sales_cents))}</text>`;
}

function customerTypeIcon(kind, cx, cy, size, color) {
  const scale = size / 32;
  if (kind === 'retail_walk_in') {
    return `<g transform="translate(${cx} ${cy}) scale(${scale})" fill="none" stroke="${color}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" opacity=".55">
      <path d="M-13-8H13L11 13H-11Z"/><path d="M-7-8C-7-18 7-18 7-8"/>
    </g>`;
  }
  if (kind === 'wholesale_walk_in') {
    return `<g transform="translate(${cx} ${cy}) scale(${scale})" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" opacity=".5">
      <path d="M-14-8H14L10-15H-10Z"/><path d="M-12-8V12H12V-8"/><path d="M-5 12V2H5V12"/>
    </g>`;
  }
  return `<g transform="translate(${cx} ${cy}) scale(${scale})" fill="${color}" opacity=".46">
    <circle cx="-6" cy="-7" r="6"/><circle cx="7" cy="-5" r="5"/>
    <path d="M-16 12C-15 2-10-1-5-1S5 2 6 12Z"/><path d="M3 12C4 4 8 1 12 2C16 3 18 7 18 12Z"/>
  </g>`;
}

function customerTreemap(items, x, y, width, height) {
  if (!items.length) return `<text x="${x + width / 2}" y="${y + height / 2}" text-anchor="middle" font-size="25" fill="${COLORS.faint}">本月无客户销售记录</text>`;
  const rows = items.slice(0, 5);
  if (rows.length === 1) {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="20" fill="#DCEBFF"/>${treemapText(rows[0], x, y, width, height, true)}`;
  }
  const leftWidth = Math.round(width * 0.51);
  const rightX = x + leftWidth + 8;
  const rightWidth = width - leftWidth - 8;
  const topHeight = Math.round(height * 0.33);
  const middleHeight = Math.round(height * 0.33);
  const bottomY = y + topHeight + middleHeight + 16;
  const bottomHeight = height - topHeight - middleHeight - 16;
  const bottomLeftWidth = Math.round(rightWidth * 0.53);
  const specs = [
    { x, y, width: leftWidth, height, fill: '#CFE4FF', large: true },
    { x: rightX, y, width: rightWidth, height: topHeight, fill: '#D9F3EB' },
    { x: rightX, y: y + topHeight + 8, width: rightWidth, height: middleHeight, fill: '#E6E3FF' },
    { x: rightX, y: bottomY, width: bottomLeftWidth, height: bottomHeight, fill: '#FFF0D8' },
    { x: rightX + bottomLeftWidth + 8, y: bottomY, width: rightWidth - bottomLeftWidth - 8, height: bottomHeight, fill: '#DDF3FA' }
  ];
  return rows.map((item, index) => {
    const spec = specs[index];
    const iconSize = spec.large ? 42 : spec.height < 80 ? 24 : 30;
    const iconX = spec.x + (spec.large ? 42 : 28);
    const iconY = spec.y + spec.height - (spec.large ? 36 : 25);
    const iconColor = [COLORS.blue, COLORS.mint, COLORS.violet, COLORS.amber, '#45A7C4'][index];
    return `<rect x="${spec.x}" y="${spec.y}" width="${spec.width}" height="${spec.height}" rx="18" fill="${spec.fill}" stroke="#FFFFFF" stroke-width="3"/>
      ${treemapText(item, spec.x, spec.y, spec.width, spec.height, spec.large)}
      ${customerTypeIcon(item.kind || 'customer', iconX, iconY, iconSize, iconColor)}`;
  }).join('');
}

function renderGoodsAndStaff(model, variant = 'clean') {
  const volumeMax = Math.max(...model.products.volume_top.map((row) => row.quantity), 1);
  const profitMax = Math.max(...model.products.profit_top.map((row) => row.profit_cents), 1);
  const purchaseAmount = model.purchase.total_amount_cents > 0
    ? compactMoney(model.purchase.total_amount_cents)
    : '¥0.00';
  const purchaseEmptyState = model.purchase.total_amount_cents === 0 && model.purchase.order_count === 0
    ? '本月无进货记录'
    : '';
  const outRows = model.risks.out_of_stock;
  const lowRows = model.risks.low_stock;
  let body = `${page2Backdrop()}${jointLogo()}`;

  const showComparison = variant === 'compare';
  const metricLabelY = showComparison ? 202 : 226;
  const metricValueY = showComparison ? 266 : 294;
  body += `${texturedCard(48, 144, 984, 228, 34, 'purchaseCardClip', '#BCEFE2')}
    <rect x="84" y="179" width="6" height="34" rx="3" fill="${COLORS.mint}"/>
    <text x="110" y="208" font-size="30" font-weight="820" fill="${COLORS.ink}">进货统计</text>
    <g opacity=".16"><path d="M 137 255 H 205 L 213 326 H 129 Z" fill="${COLORS.mint}"/><path d="M 149 256 C 149 225 193 225 193 256" fill="none" stroke="${COLORS.mint}" stroke-width="10" stroke-linecap="round"/></g>
    ${purchaseEmptyState ? `<text x="1000" y="204" text-anchor="end" font-size="22" fill="${COLORS.faint}">${purchaseEmptyState}</text>` : ''}
    <text x="326" y="${metricLabelY}" font-size="22" fill="${COLORS.muted}">进货总金额</text>
    <text x="326" y="${metricValueY}" font-size="42" font-weight="850" fill="${COLORS.ink}">${esc(purchaseAmount)}</text>
    ${showComparison ? purchaseComparison(326, 324, model.purchase_comparison.amount) : ''}
    <line x1="548" y1="184" x2="548" y2="326" stroke="#E5ECF6"/>
    <text x="590" y="${metricLabelY}" font-size="22" fill="${COLORS.muted}">进货次数</text>
    <text x="590" y="${metricValueY}" font-size="42" font-weight="850" fill="${COLORS.ink}">${model.purchase.order_count.toLocaleString('zh-CN')} 笔</text>
    ${showComparison ? purchaseComparison(590, 324, model.purchase_comparison.orders) : ''}
    <line x1="776" y1="184" x2="776" y2="326" stroke="#E5ECF6"/>
    <text x="818" y="${metricLabelY}" font-size="22" fill="${COLORS.muted}">进货商品</text>
    <text x="818" y="${metricValueY}" font-size="42" font-weight="850" fill="${COLORS.ink}">${model.purchase.row_count.toLocaleString('zh-CN')} 种</text>
    ${showComparison ? purchaseComparison(818, 324, model.purchase_comparison.products) : ''}`;

  body += `${texturedCard(48, 396, 984, 340, 34, 'salesCardClip', '#D8E8FF')}
    ${sectionIcon('crown', 100, 445, COLORS.blue, '#EAF3FF')}
    <text x="136" y="454" font-size="28" font-weight="800" fill="${COLORS.ink}">商品销量 Top 5</text>
    <text x="994" y="453" text-anchor="end" font-size="20" fill="${COLORS.faint}">按销量排序</text>
    ${listRows({
      items: model.products.volume_top,
      x: 82,
      y: 490,
      width: 910,
      rowHeight: 49,
      maxValue: volumeMax,
      value: (row) => row.quantity,
      secondary: (row) => `${Math.round(row.quantity).toLocaleString('zh-CN')} ${row.unit}`.trim(),
      color: COLORS.blue,
      emptyText: '本月无商品销量记录'
    })}`;

  body += `${texturedCard(48, 760, 984, 340, 34, 'profitCardClip', '#CFF4EB')}
    ${sectionIcon('crown', 100, 809, COLORS.mint, '#E9F9F5')}
    <text x="136" y="818" font-size="28" font-weight="800" fill="${COLORS.ink}">商品利润 Top 5</text>
    <text x="994" y="817" text-anchor="end" font-size="20" fill="${COLORS.faint}">按利润额排序</text>
    ${listRows({
      items: model.products.profit_top,
      x: 82,
      y: 854,
      width: 910,
      rowHeight: 49,
      maxValue: profitMax,
      value: (row) => row.profit_cents,
      secondary: (row) => compactMoney(row.profit_cents),
      color: COLORS.mint,
      emptyText: '本月无商品利润记录'
    })}`;

  body += `${texturedCard(48, 1124, 476, 250, 32, 'lowStockCardClip', '#FFE4AD')}
    ${stockRiskPanel({ x: 48, y: 1124, width: 476, height: 250, title: '低库存商品', rows: lowRows, color: '#D4830B', pale: '#FFF5DF', kind: 'box', drawCard: false })}
    ${texturedCard(540, 1124, 492, 250, 32, 'outStockCardClip', '#FFD6DB')}
    ${stockRiskPanel({ x: 540, y: 1124, width: 492, height: 250, title: '缺货商品', rows: outRows, color: COLORS.coral, pale: '#FFF0F2', kind: 'warning', drawCard: false })}`;
  body += pageFooter(model, 2, { large: true, showPageNumber: false, tightSpacing: true });
  return svgShell(body);
}

function riskActions(model) {
  const low = model.risks.low_stock.slice(0, 2).map((row) => `${shortText(row.name, 7)} ${row.stock}${row.unit || ''}`).join(' · ') || '无低库存';
  const out = model.risks.out_of_stock.slice(0, 2).map((row) => shortText(row.name, 7)).join(' · ') || '无缺货';
  const actions = model.actions.length ? model.actions : ['本月暂无需要特别提醒的经营动作。'];
  return `<rect x="72" y="1262" width="446" height="62" rx="19" fill="#FFF6E9"/>
    <text x="96" y="1288" font-size="19" font-weight="650" fill="#A66A18">低库存 ${model.risks.low_stock.length} 款</text>
    <text x="96" y="1313" font-size="18" font-weight="400" fill="${COLORS.text}">${esc(low)}</text>
    <rect x="538" y="1262" width="466" height="62" rx="19" fill="#FFF0F2"/>
    <text x="562" y="1288" font-size="19" font-weight="650" fill="#C34D5A">缺货 ${model.risks.out_of_stock.length} 款</text>
    <text x="562" y="1313" font-size="18" font-weight="400" fill="${COLORS.text}">${esc(out)}</text>
    ${actions.slice(0, 3).map((action, index) => `<circle cx="92" cy="${1350 + index * 34}" r="12" fill="${[COLORS.blue, COLORS.mint, COLORS.amber][index]}"/>
      <text x="92" y="${1355 + index * 34}" text-anchor="middle" font-size="12" font-weight="700" fill="#FFFFFF">${index + 1}</text>
      <text x="120" y="${1357 + index * 34}" font-size="20" font-weight="400" fill="${COLORS.text}">${esc(shortText(action, 42))}</text>`).join('')}`;
}

function renderFundsAndActions(model) {
  const debtMax = Math.max(...model.customers.debt_top.map((row) => row.amount_cents), 1);
  let body = `${page2Backdrop()}${jointLogo()}`;

  body += `<g filter="url(#shadow)"><rect x="42" y="144" width="996" height="415" rx="32" fill="#FFFFFF" stroke="#DFE8F5"/></g>
    <text x="72" y="194" font-size="28" font-weight="800" fill="${COLORS.ink}">收款情况</text>
    ${donut(model, 190, 376, 113)}
    ${channelLegend(model, 356, 326, { rowGap: 50, amountOffset: 208, shareOffset: 280 })}
    <rect x="690" y="246" width="306" height="123" rx="22" fill="#EFF8F5" stroke="#D9EEE8"/>
    <text x="716" y="286" font-size="19" fill="#4F786F">回款率</text>
    <text x="716" y="335" font-size="32" font-weight="850" fill="#14886B">${pct(model.overview.receipt_rate)}</text>
    <g opacity=".17" fill="none" stroke="#32B797" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="949" cy="307" r="22"/><path d="M 939 316 L 958 297 M 948 297 H 958 V 307"/>
    </g>
    <rect x="690" y="383" width="306" height="123" rx="22" fill="#FFF5E9" stroke="#F4DFC2"/>
    <text x="716" y="423" font-size="19" fill="#8A6740">本月销售单待收</text>
    <text x="716" y="472" font-size="32" font-weight="850" fill="#D27A1B">${esc(fullMoney(model.overview.outstanding_cents))}</text>
    <g opacity=".18" fill="none" stroke="#E5A552" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M 931 414 H 953 L 962 423 V 470 H 931 Z"/><path d="M 953 414 V 425 H 962"/><path d="M 939 440 H 954 M 939 452 H 954"/>
    </g>`;

  body += `<g filter="url(#shadow)"><rect x="42" y="573" width="996" height="335" rx="32" fill="#FFFFFF" stroke="#DFE8F5"/></g>
    <text x="72" y="625" font-size="28" font-weight="800" fill="${COLORS.ink}">客户欠款</text>
    <text x="1006" y="624" text-anchor="end" font-size="20" fill="${COLORS.faint}">总计${model.customers.debt_total_count}位，${esc(fullMoney(model.customers.debt_total_cents))}</text>
    ${debtLineRows(model.customers.debt_top, 78, 665, 922, debtMax, 48)}`;

  body += `<g filter="url(#shadow)"><rect x="42" y="922" width="996" height="504" rx="32" fill="#FFFFFF" stroke="#DFE8F5"/></g>
    <text x="72" y="974" font-size="28" font-weight="800" fill="${COLORS.ink}">销售贡献</text>
    <text x="1006" y="973" text-anchor="end" font-size="20" fill="${COLORS.faint}">面积代表销售额</text>
    ${customerTreemap(model.customers.sales_top, 72, 1002, 934, 380)}
    ${pageFooter(model, 3, { large: true, showPageNumber: false, tightSpacing: true })}`;
  return svgShell(body);
}

export function renderMonthlyReportSvgs(model, { page2Variant = 'clean' } = {}) {
  return [
    { slug: '01-经营概览', title: '经营概览', svg: renderOverview(model) },
    { slug: '02-商品与库存', title: '商品与库存', svg: renderGoodsAndStaff(model, page2Variant) },
    { slug: '03-收款与客户', title: '收款与客户', svg: renderFundsAndActions(model) }
  ];
}

function verifyPng(path) {
  const buffer = readFileSync(path);
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new PosterError('PNG_INVALID', '渲染结果不是 PNG');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== WIDTH || height !== HEIGHT) throw new PosterError('PNG_DIMENSIONS', `PNG 尺寸错误：${width}×${height}`);
}

export async function renderMonthlyReportPngSet(model, outputDir, { keepSvg = false, page2Variant = 'clean' } = {}) {
  let sharp;
  try {
    ({ default: sharp } = await import('sharp'));
  } catch (error) {
    throw new PosterError('RENDERER_MISSING', '经营海报渲染组件未初始化', { cause_code: error?.code || 'UNKNOWN' });
  }
  const absoluteDir = resolve(outputDir);
  mkdirSync(absoluteDir, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'ailit-monthly-report-'));
  const artifacts = [];
  try {
    for (const page of renderMonthlyReportSvgs(model, { page2Variant })) {
      const base = `经营月报-${model.period.month}-${page.slug}`;
      const temporaryPng = join(work, `${base}.png`);
      await sharp(Buffer.from(page.svg)).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(temporaryPng);
      verifyPng(temporaryPng);
      const finalPng = join(absoluteDir, `${base}.png`);
      renameSync(temporaryPng, finalPng);
      let finalSvg = null;
      if (keepSvg) {
        finalSvg = join(absoluteDir, `${base}.svg`);
        writeFileSync(finalSvg, page.svg, 'utf8');
      }
      artifacts.push({ title: page.title, png: finalPng, svg: finalSvg });
    }
  } catch (error) {
    throw error instanceof PosterError ? error : new PosterError('RENDER_FAILED', `经营月报渲染失败：${error.message}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return artifacts;
}
