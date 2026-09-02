import { PosterError } from './calendar-core.mjs';

export function userMessageFor(error, artifact) {
  const code = error instanceof PosterError ? error.code : 'UNEXPECTED';
  const label = artifact === 'calendar' ? '经营日历' : '经营月报';

  if (['NODE_UNSUPPORTED', 'ASSET_INVALID', 'RENDERER_MISSING'].includes(code)) {
    return '智慧记图报暂时无法生成，请稍后再试。';
  }
  if (['AILIT_MISSING', 'AILIT_UNSUPPORTED', 'AILIT_CAPABILITY_MISSING', 'AILIT_UNHEALTHY'].includes(code)) {
    return '暂时无法读取智慧记经营数据，请检查智慧记连接后再试。';
  }
  if (code === 'SHOP_MISSING') return '当前还没有选择经营店铺，请先在智慧记中选择店铺。';
  if (code === 'SALES_RETURN_UNVERIFIED') {
    return `部分退货数据暂时无法准确核对，为避免金额错误，本次没有生成${label}。`;
  }
  if (code.startsWith('RECEIPT_')) {
    return `部分收款记录暂时无法准确核对，为避免金额错误，本次没有生成${label}。`;
  }
  if (code === 'INVALID_MONTH') return '月份格式不正确，请告诉我具体月份。';
  if (code === 'FUTURE_MONTH') return '暂时不能查看未来月份，请换一个月份。';
  if (code === 'OUTPUT_EXISTS') return '已有同名结果，为避免覆盖，本次没有重新生成。';
  if (['MISSING_ARGUMENT', 'UNKNOWN_ARGUMENT', 'INVALID_ARGUMENT'].includes(code)) {
    return '请求内容暂时无法识别，请换一种说法后再试。';
  }
  if (code.startsWith('AILIT_')) return '智慧记经营数据暂时读取失败，请稍后再试。';
  if (code.startsWith('PAGINATION_')
    || code.startsWith('CROSS_CHECK_')
    || code.endsWith('_SHAPE')
    || code.endsWith('_MISMATCH')
    || code === 'UNSUPPORTED_SOURCE_FIELDS') {
    return `部分经营数据暂时无法完整核对，为避免内容错误，本次没有生成${label}。`;
  }
  return `智慧记${label}暂时无法生成，请稍后再试。`;
}
