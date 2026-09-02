import workbuddyLogo from './embedded-workbuddy-logo.mjs';
import zhihuijiLogo from './embedded-zhihuiji-logo.mjs';
import zhihuijiQr from './embedded-zhihuiji-qr.mjs';
import calendarHeader from './embedded-calendar-header.mjs';
import monthlyHeader from './embedded-monthly-header.mjs';
import { createHash } from 'node:crypto';

const PREFIX = 'data:image/png;base64,';
const ASSETS = Object.freeze({
  "assets/brand/workbuddy-logo.png": workbuddyLogo,
  "assets/brand/zhihuiji-logo.png": zhihuijiLogo,
  "assets/brand/zhihuiji-qr.png": zhihuijiQr,
  "assets/calendar/header-store-calendar.png": calendarHeader,
  "assets/monthly-report/header-overview-glass-cutout-v3.png": monthlyHeader
});

export const EMBEDDED_ASSET_META = Object.freeze({
  "assets/brand/workbuddy-logo.png": Object.freeze({ size: 272739, sha256: '8458707673cda7528abac36908e6ac0c82d2b1f7558ba6344a676a68db83f44f' }),
  "assets/brand/zhihuiji-logo.png": Object.freeze({ size: 18158, sha256: '3107c43ad04a6cbad3f81835ee4e90b7d4a2675b5aaba5ffe1c608d1eb40fe79' }),
  "assets/brand/zhihuiji-qr.png": Object.freeze({ size: 97027, sha256: '83af63bc019591dba57001f27bd66efbe2ad6a3c99dd18a9e08587ee4664d55e' }),
  "assets/calendar/header-store-calendar.png": Object.freeze({ size: 843373, sha256: '26c611c7489f9aff77ee768321756bc4c1ea08705cf77109e85f9be9f8303394' }),
  "assets/monthly-report/header-overview-glass-cutout-v3.png": Object.freeze({ size: 368550, sha256: '8ac4a803b158957f94a3d2cbdd09afef66c84fc64b3e42803c64b67b5182a42a' })
});

export function embeddedImageData(path) {
  const value = ASSETS[path];
  if (!value) throw new Error(`未找到内置图片资源：${path}`);
  return value;
}

export function validateEmbeddedAssets() {
  for (const [path, meta] of Object.entries(EMBEDDED_ASSET_META)) {
    const value = embeddedImageData(path);
    if (!value.startsWith(PREFIX)) throw new Error(`内置图片格式错误：${path}`);
    const buffer = Buffer.from(value.slice(PREFIX.length), 'base64');
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    if (buffer.length !== meta.size || sha256 !== meta.sha256) throw new Error(`内置图片校验失败：${path}`);
  }
  return { ok: true, count: Object.keys(EMBEDDED_ASSET_META).length };
}
